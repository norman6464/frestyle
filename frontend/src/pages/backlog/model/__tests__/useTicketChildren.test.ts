import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTicketChildren } from '../useTicketChildren';
import type { Ticket } from '@/entities/ticket';

const hoisted = vi.hoisted(() => ({
  fetchTicketChildren: vi.fn(),
}));

vi.mock('@/entities/ticket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/ticket')>();
  return {
    ...actual,
    TicketRepository: { fetchTicketChildren: hoisted.fetchTicketChildren },
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
    title: '子',
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
const TICKET = 't-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTicketChildren', () => {
  it('宛先が揃ったら取得する', async () => {
    hoisted.fetchTicketChildren.mockResolvedValue([ticket({ id: 'c-1' })]);
    const { result } = renderHook(() => useTicketChildren(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.children).toHaveLength(1);
    expect(hoisted.fetchTicketChildren).toHaveBeenCalledWith(SLUG, TICKET);
  });

  it('取得失敗は文言を出す', async () => {
    hoisted.fetchTicketChildren.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketChildren(SLUG, TICKET));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it('宛先が揃っていなければ何もしない', () => {
    const { result } = renderHook(() => useTicketChildren(undefined, undefined));
    expect(result.current.children).toEqual([]);
    expect(hoisted.fetchTicketChildren).not.toHaveBeenCalled();
  });

  it('refresh で取り直す', async () => {
    hoisted.fetchTicketChildren.mockResolvedValue([]);
    const { result } = renderHook(() => useTicketChildren(SLUG, TICKET));
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.fetchTicketChildren.mockResolvedValue([ticket({ id: 'c-1' })]);
    result.current.refresh();
    await waitFor(() => expect(result.current.children).toHaveLength(1));
  });
});
