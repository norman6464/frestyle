import { renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Ticket } from '@/entities/ticket';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useTicketChildCount, useTicketChildren } from '../useTicketChildren';

const hoisted = vi.hoisted(() => ({
  fetchTicketChildren: vi.fn(),
}));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: { fetchTicketChildren: hoisted.fetchTicketChildren },
}));

// 共有の問い合わせを使うので、テストごとに新しい置き場の中で描く。
const renderHook = ((callback, options) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

function httpError(status: number): AxiosError {
  return new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

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

describe('useTicketChildCount', () => {
  it('節の中身と同じ結果を数え、取り直さない', async () => {
    hoisted.fetchTicketChildren.mockResolvedValue([ticket({ id: 'c-1' }), ticket({ id: 'c-2' })]);
    const client = createTestQueryClient();
    const section = renderHook(() => useTicketChildren(SLUG, TICKET), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(section.result.current.children).toHaveLength(2));

    const { result } = renderHook(() => useTicketChildCount(SLUG, TICKET), { wrapper: queryWrapper(client) });
    expect(result.current).toBe(2);
    expect(hoisted.fetchTicketChildren).toHaveBeenCalledTimes(1);
  });

  it('読めていない間と読めなかったときは undefined（0 と取り違えない）', async () => {
    hoisted.fetchTicketChildren.mockRejectedValue(httpError(500));
    const { result } = renderHook(() => useTicketChildCount(SLUG, TICKET));
    expect(result.current).toBeUndefined();
    await waitFor(() => expect(hoisted.fetchTicketChildren).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current).toBeUndefined();
  });
});
