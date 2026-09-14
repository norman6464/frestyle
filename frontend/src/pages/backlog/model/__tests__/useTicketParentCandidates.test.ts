import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTicketParentCandidates } from '../useTicketParentCandidates';
import type { Ticket } from '@/entities/ticket';

const hoisted = vi.hoisted(() => ({
  fetchTickets: vi.fn(),
}));

vi.mock('@/entities/ticket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/ticket')>();
  return {
    ...actual,
    TicketRepository: { fetchTickets: hoisted.fetchTickets },
  };
});

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
});
