import { renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketKeys } from '@/entities/ticket';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useCommentEdits } from '../useCommentEdits';

const hoisted = vi.hoisted(() => ({ fetchTicketCommentEdits: vi.fn() }));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: { fetchTicketCommentEdits: hoisted.fetchTicketCommentEdits },
}));

// 共有の問い合わせを使うので、テストごとに新しい置き場の中で描く。
const renderHook = ((callback, options) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const edit = (id: string) => ({ id, editor: { userId: 1, name: '田中 太郎' }, previousBody: [], editedAt: '' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCommentEdits', () => {
  it('開くまで何もしない', () => {
    const { result } = renderHook(() => useCommentEdits('acme', 't-1', 'c-1', false));
    expect(hoisted.fetchTicketCommentEdits).not.toHaveBeenCalled();
    expect(result.current).toEqual({ edits: [], loading: false, error: null });
  });

  it('開くと編集履歴を引く', async () => {
    hoisted.fetchTicketCommentEdits.mockResolvedValue([edit('e-1')]);
    const { result } = renderHook(() => useCommentEdits('acme', 't-1', 'c-1', true));

    await waitFor(() => expect(result.current.edits).toHaveLength(1));
    expect(hoisted.fetchTicketCommentEdits).toHaveBeenCalledWith('acme', 't-1', 'c-1');
  });

  it('失敗したら文言を出し、閉じて開き直すと取り直す', async () => {
    hoisted.fetchTicketCommentEdits.mockRejectedValueOnce(new Error('x'));
    const { result, rerender } = renderHook(({ open }) => useCommentEdits('acme', 't-1', 'c-1', open), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(result.current.error).toBe('編集履歴を読み込めませんでした。'));

    hoisted.fetchTicketCommentEdits.mockResolvedValueOnce([edit('e-1')]);
    rerender({ open: false });
    rerender({ open: true });

    await waitFor(() => expect(result.current.edits).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it('閉じて開き直しても、取ってある履歴を使い取り直さない', async () => {
    hoisted.fetchTicketCommentEdits.mockResolvedValue([edit('e-1')]);
    const { result, rerender } = renderHook(({ open }) => useCommentEdits('acme', 't-1', 'c-1', open), {
      initialProps: { open: true },
    });
    await waitFor(() => expect(result.current.edits).toHaveLength(1));

    rerender({ open: false });
    rerender({ open: true });

    expect(result.current.edits).toHaveLength(1);
    expect(hoisted.fetchTicketCommentEdits).toHaveBeenCalledTimes(1);
  });

  it('発言を編集して古くなった履歴は、開いたときに取り直す', async () => {
    hoisted.fetchTicketCommentEdits.mockResolvedValueOnce([edit('e-1')]);
    const client = createTestQueryClient();
    const { result, rerender } = renderHook(({ open }) => useCommentEdits('acme', 't-1', 'c-1', open), {
      initialProps: { open: true },
      wrapper: queryWrapper(client),
    });
    await waitFor(() => expect(result.current.edits).toHaveLength(1));
    rerender({ open: false });

    // 編集の書き込み（useTicketComments）が古くする。
    void client.invalidateQueries({ queryKey: ticketKeys.commentEdits('acme', 't-1', 'c-1') });
    hoisted.fetchTicketCommentEdits.mockResolvedValueOnce([edit('e-1'), edit('e-2')]);
    rerender({ open: true });

    await waitFor(() => expect(result.current.edits).toHaveLength(2));
  });
});
