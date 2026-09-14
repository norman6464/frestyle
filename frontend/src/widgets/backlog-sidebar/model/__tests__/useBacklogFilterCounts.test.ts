import { renderHook, waitFor } from '@testing-library/react';
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
    hoisted.fetchTicketCounts.mockResolvedValue({ total: 5, assignedToMe: 2, overdue: 1, unassigned: 3 });
    const { result } = renderHook(() => useBacklogFilterCounts(SLUG, SPACE));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(hoisted.fetchTicketCounts).toHaveBeenCalledWith(SLUG, SPACE);
    expect(result.current).toEqual({ total: 5, assignedToMe: 2, overdue: 1, unassigned: 3 });
  });

  it('取得に失敗しても壊れず null のまま(0 件と同じ表示になる)', async () => {
    hoisted.fetchTicketCounts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useBacklogFilterCounts(SLUG, SPACE));
    await waitFor(() => expect(hoisted.fetchTicketCounts).toHaveBeenCalled());
    expect(result.current).toBeNull();
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
    await waitFor(() => expect(result.current?.total).toBe(9));

    resolveFirst({ total: 1, assignedToMe: 1, overdue: 1, unassigned: 1 });
    await Promise.resolve();
    expect(result.current?.total).toBe(9);
  });
});
