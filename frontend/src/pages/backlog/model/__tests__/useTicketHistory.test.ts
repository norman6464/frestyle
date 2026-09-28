import { renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketKeys } from '@/entities/ticket';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useTicketHistory } from '../useTicketHistory';

const hoisted = vi.hoisted(() => ({ fetchTicketHistory: vi.fn() }));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: { fetchTicketHistory: hoisted.fetchTicketHistory },
}));

// 共有の問い合わせを使うので、テストごとに新しい置き場の中で描く。
const renderHook = ((callback, options) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const group = (id: string) => ({ id, actor: { userId: 1, name: '田中 太郎' }, changedAt: '', items: [] });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTicketHistory', () => {
  it('チケットが決まるまで取りに行かない', () => {
    const { result } = renderHook(() => useTicketHistory('acme', null));
    expect(result.current).toEqual({ history: [], loading: false, error: null });
    expect(hoisted.fetchTicketHistory).not.toHaveBeenCalled();
  });

  it('決まったら取得する', async () => {
    hoisted.fetchTicketHistory.mockResolvedValue([group('g-1')]);
    const { result } = renderHook(() => useTicketHistory('acme', 't-1'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.history).toHaveLength(1));
    expect(hoisted.fetchTicketHistory).toHaveBeenCalledWith('acme', 't-1');
  });

  it('読めなければ文言を出す', async () => {
    hoisted.fetchTicketHistory.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketHistory('acme', 't-1'));
    await waitFor(() => expect(result.current.error).toBe('変更履歴を読み込めませんでした。'));
  });

  it('チケットを書き換えて古くなったら取り直し、新しい行を出す（出していた履歴は隠さない）', async () => {
    hoisted.fetchTicketHistory.mockResolvedValueOnce([group('g-1')]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => useTicketHistory('acme', 't-1'), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.history).toHaveLength(1));

    hoisted.fetchTicketHistory.mockResolvedValueOnce([group('g-2'), group('g-1')]);
    void client.invalidateQueries({ queryKey: ticketKeys.history('acme', 't-1') });

    expect(result.current.loading).toBe(false);
    await waitFor(() => expect(result.current.history.map((g) => g.id)).toEqual(['g-2', 'g-1']));
  });
});
