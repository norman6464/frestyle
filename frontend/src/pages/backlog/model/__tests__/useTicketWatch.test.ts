import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryWrapper } from '@/test/queryClient';
import { useTicketWatch } from '../useTicketWatch';

const hoisted = vi.hoisted(() => ({ fetchTicketWatchState: vi.fn(), setTicketWatching: vi.fn() }));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: { fetchTicketWatchState: hoisted.fetchTicketWatchState, setTicketWatching: hoisted.setTicketWatching },
}));

// 共有の問い合わせを使うので、テストごとに新しい置き場の中で描く。
const renderHook = ((callback, options) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTicketWatch', () => {
  it('状態が取れるまでは null、取れたら監視しているかと人数を返す', async () => {
    hoisted.fetchTicketWatchState.mockResolvedValue({ watching: false, count: 2 });
    const { result } = renderHook(() => useTicketWatch('acme', 't-1'));
    expect(result.current.watch).toBeNull();
    await waitFor(() => expect(result.current.watch).toEqual({ watching: false, count: 2 }));
  });

  it('取れなければ null のまま（押せないまま畳む）', async () => {
    hoisted.fetchTicketWatchState.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketWatch('acme', 't-1'));
    await waitFor(() => expect(hoisted.fetchTicketWatchState).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.watch).toBeNull();
  });

  it('「どちらにしたいか」を送り、返ってきた状態を映す。送っている間は busy', async () => {
    hoisted.fetchTicketWatchState.mockResolvedValue({ watching: false, count: 2 });
    let finish!: (state: { watching: boolean; count: number }) => void;
    hoisted.setTicketWatching.mockImplementation(() => new Promise((resolve) => (finish = resolve)));
    const { result } = renderHook(() => useTicketWatch('acme', 't-1'));
    await waitFor(() => expect(result.current.watch).not.toBeNull());

    let sending!: Promise<void>;
    act(() => {
      sending = result.current.setWatching(true);
    });
    expect(result.current.busy).toBe(true);
    expect(hoisted.setTicketWatching).toHaveBeenCalledWith('acme', 't-1', true);

    await act(async () => {
      finish({ watching: true, count: 3 });
      await sending;
    });
    await waitFor(() => expect(result.current.watch).toEqual({ watching: true, count: 3 }));
    expect(result.current.busy).toBe(false);
  });

  it('失敗したら投げ、状態は変えずに busy を下ろす', async () => {
    hoisted.fetchTicketWatchState.mockResolvedValue({ watching: false, count: 2 });
    hoisted.setTicketWatching.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useTicketWatch('acme', 't-1'));
    await waitFor(() => expect(result.current.watch).not.toBeNull());

    await act(async () => {
      await expect(result.current.setWatching(true)).rejects.toThrow('403');
    });
    expect(result.current.watch).toEqual({ watching: false, count: 2 });
    expect(result.current.busy).toBe(false);
  });

  it('別のチケットへ移ったら、前のチケットの状態は出さない', async () => {
    hoisted.fetchTicketWatchState.mockResolvedValueOnce({ watching: true, count: 5 });
    hoisted.fetchTicketWatchState.mockImplementationOnce(() => new Promise(() => {}));
    const { result, rerender } = renderHook(({ ticketId }) => useTicketWatch('acme', ticketId), {
      initialProps: { ticketId: 't-1' },
    });
    await waitFor(() => expect(result.current.watch).not.toBeNull());

    rerender({ ticketId: 't-2' });
    expect(result.current.watch).toBeNull();
  });
});
