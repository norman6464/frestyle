import { renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Ticket } from '@/entities/ticket';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useTicketList } from '../useTicketList';
import { useTicketParentCandidates } from '../useTicketParentCandidates';

const hoisted = vi.hoisted(() => ({
  fetchTickets: vi.fn(),
}));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: { fetchTickets: hoisted.fetchTickets },
}));

// 共有の問い合わせを使うので、テストごとに新しい置き場の中で描く。
const renderHook = ((callback, options) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

function ticket(over: Partial<Ticket> & { id: string }): Ticket {
  return {
    workspaceId: 'w-1',
    projectId: 's-1',
    number: 1,
    typeId: 'ty-1',
    statusId: 'st-1',
    parentId: null,
    title: '候補',
    doc: { type: 'doc', content: [] },
    priority: 2,
    startDate: null,
    dueDate: null,
    position: 'a0',
    closedAt: null,
    resolution: null,
    createdByUserId: 1,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    assigneePrincipalId: null,
    labels: [],
    ...over,
  };
}

const SLUG = 'acme';
const SPACE = 's-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTicketParentCandidates', () => {
  it('宛先が揃ったら取得する', async () => {
    hoisted.fetchTickets.mockResolvedValue([ticket({ id: 't-1' }), ticket({ id: 't-2' })]);
    const { result } = renderHook(() => useTicketParentCandidates(SLUG, SPACE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.candidates).toHaveLength(2);
    expect(hoisted.fetchTickets).toHaveBeenCalledWith(SLUG, SPACE, {});
  });

  it('取得失敗は文言を出す', async () => {
    hoisted.fetchTickets.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketParentCandidates(SLUG, SPACE));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it('宛先が揃っていなければ何もしない（ピッカーを開くまで問い合わせない）', () => {
    const { result } = renderHook(() => useTicketParentCandidates(undefined, undefined));
    expect(result.current.candidates).toEqual([]);
    expect(hoisted.fetchTickets).not.toHaveBeenCalled();
  });

  it('バックログの絞り込んでいない現役の一覧と同じ控えを使い、開いても取り直さない', async () => {
    hoisted.fetchTickets.mockResolvedValue([ticket({ id: 't-1' })]);
    const client = createTestQueryClient();
    const list = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(list.result.current.tickets).toHaveLength(1));

    const { result } = renderHook(() => useTicketParentCandidates(SLUG, SPACE), { wrapper: queryWrapper(client) });
    expect(result.current.candidates.map((t) => t.id)).toEqual(['t-1']);
    expect(hoisted.fetchTickets).toHaveBeenCalledTimes(1);
  });
});
