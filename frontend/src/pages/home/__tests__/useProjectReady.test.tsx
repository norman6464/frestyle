import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketKeys } from '@/entities/ticket/api/ticketQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useProjectReady } from '../model/useCreateTargets';

const hoisted = vi.hoisted(() => ({ fetchTicketStatuses: vi.fn() }));

vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: { fetchTicketStatuses: hoisted.fetchTicketStatuses },
}));

const INITIAL = { id: 's-1', isInitial: true };
const OTHER = { id: 's-2', isInitial: false };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useProjectReady', () => {
  it('初期状態があれば使える', async () => {
    hoisted.fetchTicketStatuses.mockResolvedValue([OTHER, INITIAL]);
    const { result } = renderHook(() => useProjectReady('acme', 'p-1'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current).toMatchObject({ data: true, status: 'ready' }));
  });

  it('初期状態が無ければ使えない（プロジェクトの設定が済んでいない）', async () => {
    hoisted.fetchTicketStatuses.mockResolvedValue([OTHER]);
    const { result } = renderHook(() => useProjectReady('acme', 'p-1'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current).toMatchObject({ data: false, status: 'ready' }));
  });

  it('プロジェクトを選ぶまでは読まない', () => {
    const { result } = renderHook(() => useProjectReady('acme', null), { wrapper: queryWrapper() });

    expect(result.current.status).toBe('loading');
    expect(hoisted.fetchTicketStatuses).not.toHaveBeenCalled();
  });

  it('バックログなどで取ってある状態の一覧を使い、取り直さない', async () => {
    const client = createTestQueryClient();
    client.setQueryData(ticketKeys.statuses('acme', 'p-1'), [INITIAL]);
    const { result } = renderHook(() => useProjectReady('acme', 'p-1'), { wrapper: queryWrapper(client) });

    await waitFor(() => expect(result.current).toMatchObject({ data: true, status: 'ready' }));
    expect(hoisted.fetchTicketStatuses).not.toHaveBeenCalled();
  });
});
