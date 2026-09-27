import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTicketComments } from '../useTicketComments';
import type { TicketComment } from '@/entities/ticket';

const hoisted = vi.hoisted(() => ({
  fetchTicketComments: vi.fn(),
  createTicketComment: vi.fn(),
  updateTicketComment: vi.fn(),
  deleteTicketComment: vi.fn(),
  addTicketCommentReaction: vi.fn(),
  removeTicketCommentReaction: vi.fn(),
}));

vi.mock('@/entities/ticket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/ticket')>();
  return {
    ...actual,
    TicketRepository: {
      fetchTicketComments: hoisted.fetchTicketComments,
      createTicketComment: hoisted.createTicketComment,
      updateTicketComment: hoisted.updateTicketComment,
      deleteTicketComment: hoisted.deleteTicketComment,
      addTicketCommentReaction: hoisted.addTicketCommentReaction,
      removeTicketCommentReaction: hoisted.removeTicketCommentReaction,
    },
  };
});

function fixtureComment(over: Partial<TicketComment> & { id: string }): TicketComment {
  return {
    parentCommentId: null,
    author: { userId: 1, name: '田中 太郎' },
    body: [{ kind: 'text', text: 'x' }],
    edited: false,
    reactions: [],
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const SLUG = 'acme';
const TICKET = 't-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTicketComments', () => {
  it('宛先が揃ったら取得する', async () => {
    hoisted.fetchTicketComments.mockResolvedValue([fixtureComment({ id: 'c-1' })]);
    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.comments).toHaveLength(1);
    expect(hoisted.fetchTicketComments).toHaveBeenCalledWith(SLUG, TICKET);
  });

  it('取得失敗は文言を出す', async () => {
    hoisted.fetchTicketComments.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.comments).toEqual([]);
  });

  it('宛先が揃っていなければ何もしない', () => {
    const { result } = renderHook(() => useTicketComments(undefined, undefined));
    expect(result.current.loading).toBe(false);
    expect(hoisted.fetchTicketComments).not.toHaveBeenCalled();
  });

  it('作成すると末尾に足す', async () => {
    hoisted.fetchTicketComments.mockResolvedValue([]);
    const created = fixtureComment({ id: 'c-new' });
    hoisted.createTicketComment.mockResolvedValue(created);

    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createComment([{ kind: 'text', text: 'hi' }]);
    });

    expect(result.current.comments).toEqual([created]);
    expect(hoisted.createTicketComment).toHaveBeenCalledWith(SLUG, TICKET, [{ kind: 'text', text: 'hi' }], undefined);
  });

  it('編集は本文・edited・updatedAt だけ差し替え、反応は手元の値を残す', async () => {
    const original = fixtureComment({ id: 'c-1', reactions: [{ userId: 9, emoji: '👍' }] });
    hoisted.fetchTicketComments.mockResolvedValue([original]);
    // 編集の応答は reactions が常に空配列で返る（backend の実仕様）。
    hoisted.updateTicketComment.mockResolvedValue({
      ...original,
      body: [{ kind: 'text', text: '直した' }],
      edited: true,
      updatedAt: '2026-09-10T00:00:00Z',
      reactions: [],
    });

    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.editComment('c-1', [{ kind: 'text', text: '直した' }]);
    });

    expect(result.current.comments[0]).toMatchObject({
      body: [{ kind: 'text', text: '直した' }],
      edited: true,
      updatedAt: '2026-09-10T00:00:00Z',
      reactions: [{ userId: 9, emoji: '👍' }],
    });
  });

  it('削除すると一覧から外す', async () => {
    hoisted.fetchTicketComments.mockResolvedValue([fixtureComment({ id: 'c-1' })]);
    hoisted.deleteTicketComment.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteComment('c-1');
    });

    expect(result.current.comments).toEqual([]);
  });

  it('反応の追加は204のあと手元で足す。同じ反応を二重に足さない', async () => {
    hoisted.fetchTicketComments.mockResolvedValue([
      fixtureComment({ id: 'c-1', reactions: [{ userId: 5, emoji: '👍' }] }),
    ]);
    hoisted.addTicketCommentReaction.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addReaction('c-1', '👍', 5);
    });

    expect(result.current.comments[0].reactions).toEqual([{ userId: 5, emoji: '👍' }]);
  });

  it('反応の削除は204のあと手元で外す', async () => {
    hoisted.fetchTicketComments.mockResolvedValue([
      fixtureComment({ id: 'c-1', reactions: [{ userId: 5, emoji: '👍' }] }),
    ]);
    hoisted.removeTicketCommentReaction.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeReaction('c-1', '👍', 5);
    });

    expect(result.current.comments[0].reactions).toEqual([]);
  });

  it('宛先を切り替えたら古い応答での書き込み反映を無視する', async () => {
    let resolveFirst!: (v: TicketComment[]) => void;
    hoisted.fetchTicketComments.mockImplementationOnce(
      () =>
        new Promise<TicketComment[]>((resolve) => {
          resolveFirst = resolve;
        }),
    );
    hoisted.fetchTicketComments.mockResolvedValueOnce([fixtureComment({ id: 'c-2' })]);

    const { result, rerender } = renderHook(({ ticketId }) => useTicketComments(SLUG, ticketId), {
      initialProps: { ticketId: 't-1' },
    });
    rerender({ ticketId: 't-2' });

    await waitFor(() => expect(result.current.comments.map((c) => c.id)).toEqual(['c-2']));

    resolveFirst([fixtureComment({ id: 'c-1-old' })]);
    await new Promise((r) => setTimeout(r, 0));

    expect(result.current.comments.map((c) => c.id)).toEqual(['c-2']);
  });
});

describe('useTicketComments の開き直し', () => {
  it('閉じてすぐ同じチケットを開き直したあとに、前の書き込みの応答を重ねない（二重に増えない）', async () => {
    const created = fixtureComment({ id: 'c-new' });
    let resolveCreate: (value: TicketComment) => void = () => {};
    hoisted.createTicketComment.mockImplementation(
      () =>
        new Promise<TicketComment>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    hoisted.fetchTicketComments.mockResolvedValueOnce([]);
    const { result, rerender } = renderHook(({ ticketId }) => useTicketComments(SLUG, ticketId), {
      initialProps: { ticketId: TICKET as string | undefined },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    // 送信中に閉じて、すぐ同じチケットを開き直す。開き直しの取得には、送った発言がもう入っている。
    let sending: Promise<unknown> = Promise.resolve();
    act(() => {
      sending = result.current.createComment([{ kind: 'text', text: 'x' }]);
    });
    rerender({ ticketId: undefined });
    hoisted.fetchTicketComments.mockResolvedValueOnce([created]);
    rerender({ ticketId: TICKET });
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    await act(async () => {
      resolveCreate(created);
      await sending;
    });

    expect(result.current.comments.map((c) => c.id)).toEqual(['c-new']);
  });
});
