import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBacklogFilterCounts } from '../useBacklogFilterCounts';

const hoisted = vi.hoisted(() => ({
  fetchTicketCounts: vi.fn(),
}));

vi.mock('@/entities/ticket', () => ({
  TicketRepository: { fetchTicketCounts: hoisted.fetchTicketCounts },
}));

const SLUG = 'acme';
const SPACE = 's-1';
const COUNTS = { total: 5, assignedToMe: 2, overdue: 1, unassigned: 3 };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBacklogFilterCounts', () => {
  it('workspaceSlug/projectId のどちらかが欠けていれば取りに行かない', () => {
    renderHook(() => useBacklogFilterCounts(undefined, SPACE));
    renderHook(() => useBacklogFilterCounts(SLUG, undefined));
    expect(hoisted.fetchTicketCounts).not.toHaveBeenCalled();
  });

  it('揃うと取得し、応答をそのまま返す', async () => {
    hoisted.fetchTicketCounts.mockResolvedValue(COUNTS);
    const { result } = renderHook(() => useBacklogFilterCounts(SLUG, SPACE));
    await waitFor(() => expect(result.current.counts).not.toBeNull());
    expect(hoisted.fetchTicketCounts).toHaveBeenCalledWith(SLUG, SPACE);
    expect(result.current.counts).toEqual(COUNTS);
    expect(result.current.failed).toBe(false);
  });

  it('取得に失敗しても壊れず、失敗したことを failed で表に出す', async () => {
    hoisted.fetchTicketCounts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useBacklogFilterCounts(SLUG, SPACE));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.counts).toBeNull();
  });

  it('refresh で取り直す。失敗したら前の数字は残したまま failed を立て、次に成功すれば下ろす', async () => {
    hoisted.fetchTicketCounts.mockResolvedValueOnce(COUNTS);
    const { result } = renderHook(() => useBacklogFilterCounts(SLUG, SPACE));
    await waitFor(() => expect(result.current.counts).toEqual(COUNTS));

    hoisted.fetchTicketCounts.mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(result.current.counts).toEqual(COUNTS);

    hoisted.fetchTicketCounts.mockResolvedValueOnce({ ...COUNTS, overdue: 0 });
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.counts?.overdue).toBe(0));
    expect(result.current.failed).toBe(false);
    expect(hoisted.fetchTicketCounts).toHaveBeenCalledTimes(3);
  });

  it('プロジェクトを切り替えると取り直し、前の応答は無視する', async () => {
    let resolveFirst: (v: { total: number; assignedToMe: number; overdue: number; unassigned: number }) => void =
      () => {};
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    hoisted.fetchTicketCounts.mockReturnValueOnce(firstResponse);
    hoisted.fetchTicketCounts.mockResolvedValueOnce({ total: 9, assignedToMe: 9, overdue: 9, unassigned: 9 });

    const { result, rerender } = renderHook(({ projectId }) => useBacklogFilterCounts(SLUG, projectId), {
      initialProps: { projectId: 's-1' },
    });
    rerender({ projectId: 's-2' });
    await waitFor(() => expect(result.current.counts?.total).toBe(9));

    resolveFirst({ total: 1, assignedToMe: 1, overdue: 1, unassigned: 1 });
    await Promise.resolve();
    expect(result.current.counts?.total).toBe(9);
  });
});
