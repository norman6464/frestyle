import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTicketSavedFilterCounts } from '../useTicketSavedFilterCounts';

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

describe('useTicketSavedFilterCounts', () => {
  it('workspaceSlug/spaceId のどちらかが欠けていれば取りに行かない', () => {
    renderHook(() => useTicketSavedFilterCounts(undefined, SPACE));
    renderHook(() => useTicketSavedFilterCounts(SLUG, undefined));
    expect(hoisted.fetchTicketCounts).not.toHaveBeenCalled();
  });

  it('揃うと取得し、応答をそのまま返す', async () => {
    hoisted.fetchTicketCounts.mockResolvedValue({ total: 5, assignedToMe: 2, overdue: 1, unassigned: 3 });
    const { result } = renderHook(() => useTicketSavedFilterCounts(SLUG, SPACE));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(hoisted.fetchTicketCounts).toHaveBeenCalledWith(SLUG, SPACE);
    expect(result.current).toEqual({ total: 5, assignedToMe: 2, overdue: 1, unassigned: 3 });
  });

  it('取得に失敗しても壊れず null のまま(0 件と同じ表示になる)', async () => {
    hoisted.fetchTicketCounts.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTicketSavedFilterCounts(SLUG, SPACE));
    await waitFor(() => expect(hoisted.fetchTicketCounts).toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it('スペースを切り替えると取り直し、前の応答は無視する', async () => {
    let resolveFirst: (v: { total: number; assignedToMe: number; overdue: number; unassigned: number }) => void =
      () => {};
    const firstResponse = new Promise((resolve) => {
      resolveFirst = resolve;
    });
    hoisted.fetchTicketCounts.mockReturnValueOnce(firstResponse);
    hoisted.fetchTicketCounts.mockResolvedValueOnce({ total: 9, assignedToMe: 9, overdue: 9, unassigned: 9 });

    const { result, rerender } = renderHook(({ spaceId }) => useTicketSavedFilterCounts(SLUG, spaceId), {
      initialProps: { spaceId: 's-1' },
    });
    rerender({ spaceId: 's-2' });
    await waitFor(() => expect(result.current?.total).toBe(9));

    resolveFirst({ total: 1, assignedToMe: 1, overdue: 1, unassigned: 1 });
    await Promise.resolve();
    expect(result.current?.total).toBe(9);
  });
});
