import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import type { TicketStatus, TicketType } from '@/entities/ticket';
import { useTicketMasters } from '../useTicketMasters';

const hoisted = vi.hoisted(() => ({
  fetchTicketStatuses: vi.fn(),
  fetchTicketTypes: vi.fn(),
  createTicketStatus: vi.fn(),
  archiveTicketStatus: vi.fn(),
  setDefaultTicketType: vi.fn(),
}));

vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: {
    fetchTicketStatuses: hoisted.fetchTicketStatuses,
    fetchTicketTypes: hoisted.fetchTicketTypes,
    createTicketStatus: hoisted.createTicketStatus,
    archiveTicketStatus: hoisted.archiveTicketStatus,
    setDefaultTicketType: hoisted.setDefaultTicketType,
  },
}));

function status(id: string, over: Partial<TicketStatus> = {}): TicketStatus {
  return {
    id,
    workspaceId: 'w',
    projectId: 'p-1',
    name: id,
    category: 'todo',
    color: '#000000',
    position: 'a',
    isInitial: false,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    activeTicketCount: 0,
    ...over,
  };
}

function type(id: string, over: Partial<TicketType> = {}): TicketType {
  return {
    id,
    workspaceId: 'w',
    projectId: 'p-1',
    name: id,
    hierarchyLevel: 0,
    color: '#000000',
    position: 'a',
    isDefault: false,
    templateTitle: null,
    templateDoc: null,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    ...over,
  } as TicketType;
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchTicketStatuses.mockResolvedValue([status('s-1', { isInitial: true })]);
  hoisted.fetchTicketTypes.mockResolvedValue([type('t-1', { isDefault: true })]);
});

describe('useTicketMasters', () => {
  it('宛先が揃ったら状態と種別を取る', async () => {
    const { result } = renderHook(() => useTicketMasters('acme', 'p-1'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.statuses.map((s) => s.id)).toEqual(['s-1']);
    expect(result.current.types.map((t) => t.id)).toEqual(['t-1']);
    expect(hoisted.fetchTicketStatuses).toHaveBeenCalledWith('acme', 'p-1');
    expect(hoisted.fetchTicketTypes).toHaveBeenCalledWith('acme', 'p-1');
  });

  it('宛先が揃っていなければ取らず、読み込み中にもしない', () => {
    const { result } = renderHook(() => useTicketMasters('acme', undefined), { wrapper: queryWrapper() });

    expect(result.current.statuses).toEqual([]);
    expect(result.current.types).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(hoisted.fetchTicketStatuses).not.toHaveBeenCalled();
  });

  it('取得に失敗したら文言を出す', async () => {
    hoisted.fetchTicketTypes.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketMasters('acme', 'p-1'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.loading).toBe(false);
  });

  it('状態を作ったら状態の一覧を取り直す（使用中の件数は応答に無い）。種別は取り直さない', async () => {
    const { result } = renderHook(() => useTicketMasters('acme', 'p-1'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.createTicketStatus.mockResolvedValue(status('s-2'));
    hoisted.fetchTicketStatuses.mockResolvedValue([status('s-1', { isInitial: true }), status('s-2')]);

    await act(async () => {
      await result.current.createStatus({ name: 's-2', category: 'todo', color: '#000000' });
    });

    await waitFor(() => expect(result.current.statuses.map((s) => s.id)).toEqual(['s-1', 's-2']));
    expect(hoisted.fetchTicketStatuses).toHaveBeenCalledTimes(2);
    expect(hoisted.fetchTicketTypes).toHaveBeenCalledTimes(1);
  });

  it('種別の既定を変えたら種別の一覧を取り直す', async () => {
    const { result } = renderHook(() => useTicketMasters('acme', 'p-1'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.setDefaultTicketType.mockResolvedValue(undefined);

    await act(async () => {
      await result.current.setDefaultType('t-1');
    });

    await waitFor(() => expect(hoisted.fetchTicketTypes).toHaveBeenCalledTimes(2));
    expect(hoisted.fetchTicketStatuses).toHaveBeenCalledTimes(1);
  });

  it('変更に失敗したら投げ、一覧は取り直さない', async () => {
    const { result } = renderHook(() => useTicketMasters('acme', 'p-1'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.archiveTicketStatus.mockRejectedValue(new Error('status_in_use'));

    await act(async () => {
      await expect(result.current.archiveStatus('s-1')).rejects.toThrow('status_in_use');
    });

    expect(hoisted.fetchTicketStatuses).toHaveBeenCalledTimes(1);
  });

  // バックログとチケットの画面、ホームの作成の窓は同じプロジェクトの状態を使う。1 回だけ取り、
  // どこかで変えた状態はほかの場所にも出る。
  it('同じプロジェクトの状態と種別は 1 回だけ取り、ほかの場所の変更も届く', async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(
      () => ({ here: useTicketMasters('acme', 'p-1'), there: useTicketMasters('acme', 'p-1') }),
      { wrapper: queryWrapper(client) },
    );
    await waitFor(() => expect(result.current.here.loading).toBe(false));
    expect(hoisted.fetchTicketStatuses).toHaveBeenCalledTimes(1);
    hoisted.createTicketStatus.mockResolvedValue(status('s-2'));
    hoisted.fetchTicketStatuses.mockResolvedValue([status('s-1', { isInitial: true }), status('s-2')]);

    await act(async () => {
      await result.current.there.createStatus({ name: 's-2', category: 'todo', color: '#000000' });
    });

    await waitFor(() => expect(result.current.here.statuses.map((s) => s.id)).toEqual(['s-1', 's-2']));
  });

  it('一覧を持っているうちの取り直しに失敗しても、一覧を出し続ける', async () => {
    const { result } = renderHook(() => useTicketMasters('acme', 'p-1'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.fetchTicketStatuses.mockRejectedValueOnce(new Error('network'));

    act(() => result.current.refresh());
    await waitFor(() => expect(hoisted.fetchTicketStatuses).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.statuses.map((s) => s.id)).toEqual(['s-1']);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
