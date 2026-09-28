import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketKeys, type TicketComment } from '@/entities/ticket';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useTicketComments } from '../useTicketComments';

const hoisted = vi.hoisted(() => ({
  fetchTicketComments: vi.fn(),
  createTicketComment: vi.fn(),
  updateTicketComment: vi.fn(),
  deleteTicketComment: vi.fn(),
  addTicketCommentReaction: vi.fn(),
  removeTicketCommentReaction: vi.fn(),
}));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: {
    fetchTicketComments: hoisted.fetchTicketComments,
    createTicketComment: hoisted.createTicketComment,
    updateTicketComment: hoisted.updateTicketComment,
    deleteTicketComment: hoisted.deleteTicketComment,
    addTicketCommentReaction: hoisted.addTicketCommentReaction,
    removeTicketCommentReaction: hoisted.removeTicketCommentReaction,
  },
}));

// 共有の問い合わせを使うので、テストごとに新しい置き場の中で描く。
const renderHook = ((callback, options) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

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

    // 置き場の知らせは次の刻みで届くので、映るのを待つ。
    await waitFor(() => expect(result.current.comments).toEqual([created]));
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

    await waitFor(() =>
      expect(result.current.comments[0]).toMatchObject({
        body: [{ kind: 'text', text: '直した' }],
        edited: true,
        updatedAt: '2026-09-10T00:00:00Z',
        reactions: [{ userId: 9, emoji: '👍' }],
      }),
    );
  });

  it('削除すると一覧から外す', async () => {
    hoisted.fetchTicketComments.mockResolvedValue([fixtureComment({ id: 'c-1' })]);
    hoisted.deleteTicketComment.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteComment('c-1');
    });

    await waitFor(() => expect(result.current.comments).toEqual([]));
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

    await new Promise((r) => setTimeout(r, 0));
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

    await waitFor(() => expect(result.current.comments[0].reactions).toEqual([]));
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
  it('送信中に閉じて同じチケットを開き直し、取り直しに送った発言が入っていても、二重に増やさない', async () => {
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

    // 送信中に閉じて、すぐ同じチケットを開き直し、取り直す。その取得には、送った発言がもう入っている。
    let sending: Promise<unknown> = Promise.resolve();
    act(() => {
      sending = result.current.createComment([{ kind: 'text', text: 'x' }]);
    });
    rerender({ ticketId: undefined });
    rerender({ ticketId: TICKET });
    hoisted.fetchTicketComments.mockResolvedValueOnce([created]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    // 書き込みの応答を映しても、同じ発言は足さない。
    await act(async () => {
      resolveCreate(created);
      await sending;
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.comments.map((c) => c.id)).toEqual(['c-new']);
  });

  it('編集したら、その発言の編集履歴を古くする（開いたときに新しい履歴を取る）', async () => {
    const original = fixtureComment({ id: 'c-1' });
    hoisted.fetchTicketComments.mockResolvedValue([original]);
    hoisted.updateTicketComment.mockResolvedValue({ ...original, edited: true });
    const client = createTestQueryClient();
    client.setQueryData(ticketKeys.commentEdits(SLUG, TICKET, 'c-1'), []);
    client.setQueryData(ticketKeys.commentEdits(SLUG, TICKET, 'c-2'), []);
    const { result } = renderHook(() => useTicketComments(SLUG, TICKET), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    await act(async () => {
      await result.current.editComment('c-1', [{ kind: 'text', text: '直した' }]);
    });

    expect(client.getQueryState(ticketKeys.commentEdits(SLUG, TICKET, 'c-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(ticketKeys.commentEdits(SLUG, TICKET, 'c-2'))?.isInvalidated).toBe(false);
  });
});

describe('useTicketComments の書き込み中の取り直し', () => {
  it('送信中に取り直し、その応答が送信より前の一覧だったとき、送った発言を落とさない', async () => {
    const created = fixtureComment({ id: 'c-new' });
    let resolveCreate: (value: TicketComment) => void = () => {};
    hoisted.createTicketComment.mockImplementation(
      () =>
        new Promise<TicketComment>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    hoisted.fetchTicketComments.mockResolvedValueOnce([]);
    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let sending: Promise<unknown> = Promise.resolve();
    act(() => {
      sending = result.current.createComment([{ kind: 'text', text: 'x' }]);
    });
    hoisted.fetchTicketComments.mockResolvedValueOnce([]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.fetchTicketComments.mockResolvedValue([created]);
    await act(async () => {
      resolveCreate(created);
      await sending;
    });

    await waitFor(() => expect(result.current.comments.map((c) => c.id)).toEqual(['c-new']));
  });

  it('削除中に取り直し、その応答が削除より前の一覧だったとき、消した発言を残さない', async () => {
    let finishDelete: () => void = () => {};
    hoisted.deleteTicketComment.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishDelete = resolve;
        }),
    );
    hoisted.fetchTicketComments.mockResolvedValueOnce([fixtureComment({ id: 'c-1' })]);
    const { result } = renderHook(() => useTicketComments(SLUG, TICKET));
    await waitFor(() => expect(result.current.comments).toHaveLength(1));

    let deleting: Promise<unknown> = Promise.resolve();
    act(() => {
      deleting = result.current.deleteComment('c-1');
    });
    hoisted.fetchTicketComments.mockResolvedValueOnce([fixtureComment({ id: 'c-1' })]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.fetchTicketComments.mockResolvedValue([]);
    await act(async () => {
      finishDelete();
      await deleting;
    });

    await waitFor(() => expect(result.current.comments).toEqual([]));
  });
});
