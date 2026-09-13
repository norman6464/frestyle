import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTicketList } from '../useTicketList';
import type { Label, Ticket } from '@/entities/ticket';

const hoisted = vi.hoisted(() => ({
  fetchTickets: vi.fn(),
  createTicket: vi.fn(),
  archiveTicket: vi.fn(),
  restoreTicket: vi.fn(),
  changeTicketStatus: vi.fn(),
  moveTicket: vi.fn(),
  addTicketLabel: vi.fn(),
  removeTicketLabel: vi.fn(),
}));

vi.mock('@/entities/ticket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/ticket')>();
  return {
    ...actual,
    TicketRepository: {
      fetchTickets: hoisted.fetchTickets,
      createTicket: hoisted.createTicket,
      archiveTicket: hoisted.archiveTicket,
      restoreTicket: hoisted.restoreTicket,
      changeTicketStatus: hoisted.changeTicketStatus,
      moveTicket: hoisted.moveTicket,
      addTicketLabel: hoisted.addTicketLabel,
      removeTicketLabel: hoisted.removeTicketLabel,
    },
  };
});

const SLUG = 'acme';
const SPACE = 's-1';

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't-1',
    workspaceId: 'w-1',
    spaceId: SPACE,
    number: 1,
    typeId: 'ty-1',
    statusId: 'st-1',
    parentId: null,
    title: '1件目',
    doc: {},
    priority: 2,
    startDate: null,
    dueDate: null,
    position: 'a0',
    closedAt: null,
    resolution: null,
    createdByUserId: 1,
    archivedAt: null,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    assigneePrincipalId: null,
    labels: [],
    ...over,
  };
}

function label(over: Partial<Label> & { id: string }): Label {
  return { spaceId: SPACE, name: 'ラベル', color: '#1d4ed8', createdAt: '', updatedAt: '', ...over };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchTickets.mockResolvedValue([ticket({ id: 't-1', number: 1 })]);
});

describe('useTicketList', () => {
  it('workspaceSlug/spaceId のどちらかが欠けていれば取りに行かない', () => {
    renderHook(() => useTicketList(undefined, undefined, { archived: false }));
    expect(hoisted.fetchTickets).not.toHaveBeenCalled();
  });

  it('揃うと現役の絞り込みで取得する', async () => {
    const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.fetchTickets).toHaveBeenCalledWith(SLUG, SPACE, {
      archived: false,
      statusId: undefined,
      typeId: undefined,
      assigneePrincipalId: undefined,
    });
    expect(result.current.tickets).toHaveLength(1);
  });

  it('保存した絞り込み(unassigned/assignedToMe/overdue/q)をそのまま渡す', async () => {
    const { result } = renderHook(() =>
      useTicketList(SLUG, SPACE, { archived: false, unassigned: true, overdue: true, q: '認証' }),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.fetchTickets).toHaveBeenCalledWith(SLUG, SPACE, {
      archived: false,
      statusId: undefined,
      typeId: undefined,
      assigneePrincipalId: undefined,
      labelId: undefined,
      unassigned: true,
      assignedToMe: undefined,
      overdue: true,
      q: '認証',
    });
  });

  it('絞り込みが変わると取り直す(キーに含めている)', async () => {
    const { result, rerender } = renderHook(
      ({ assignedToMe }) => useTicketList(SLUG, SPACE, { archived: false, assignedToMe }),
      { initialProps: { assignedToMe: false } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.fetchTickets.mockClear();

    rerender({ assignedToMe: true });
    await waitFor(() => expect(hoisted.fetchTickets).toHaveBeenCalledTimes(1));
    expect(hoisted.fetchTickets).toHaveBeenCalledWith(
      SLUG,
      SPACE,
      expect.objectContaining({ assignedToMe: true }),
    );
  });

  it('スペースを素早く切り替えると、前のスペースの遅れた応答は捨てる', async () => {
    let resolveFirst: (tickets: Ticket[]) => void = () => {};
    const firstResponse = new Promise<Ticket[]>((resolve) => {
      resolveFirst = resolve;
    });
    hoisted.fetchTickets.mockReturnValueOnce(firstResponse);
    hoisted.fetchTickets.mockResolvedValueOnce([ticket({ id: 't-2', number: 2, spaceId: 's-2' })]);

    const { result, rerender } = renderHook(
      ({ spaceId }) => useTicketList(SLUG, spaceId, { archived: false }),
      { initialProps: { spaceId: 's-1' } },
    );

    // s-1 の取得が飛んでいる間に s-2 へ切り替える。
    rerender({ spaceId: 's-2' });
    await waitFor(() => expect(result.current.tickets).toHaveLength(1));
    expect(result.current.tickets[0].id).toBe('t-2');

    // 遅れて s-1 の応答が着地しても、今見えているのは s-2 のままなので上書きされない。
    await act(async () => {
      resolveFirst([ticket({ id: 't-1-old', number: 1 })]);
      await Promise.resolve();
    });
    expect(result.current.tickets[0].id).toBe('t-2');
  });

  it('読み込みに失敗したら理由を出し、一覧を空にする', async () => {
    hoisted.fetchTickets.mockReset();
    hoisted.fetchTickets.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/読み込めませんでした/);
    expect(result.current.tickets).toHaveLength(0);
  });

  describe('createTicket', () => {
    it('成功したら応答のチケットを末尾に足す', async () => {
      const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      hoisted.createTicket.mockResolvedValue(ticket({ id: 't-new', number: 2 }));
      await act(async () => {
        await result.current.createTicket({ title: '新規' });
      });
      expect(result.current.tickets.map((t) => t.id)).toEqual(['t-1', 't-new']);
    });
  });

  describe('archiveTicket', () => {
    it('現役タブで見ているとき、アーカイブに成功したチケットは一覧から消える', async () => {
      const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      hoisted.archiveTicket.mockResolvedValue(ticket({ id: 't-1', archivedAt: '2026-09-09T00:00:00Z' }));
      await act(async () => {
        await result.current.archiveTicket('t-1');
      });
      expect(result.current.tickets).toHaveLength(0);
    });

    it('失敗したら一覧は変えず、例外を投げる', async () => {
      const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      hoisted.archiveTicket.mockRejectedValue(new Error('409'));
      await expect(
        act(async () => {
          await result.current.archiveTicket('t-1');
        }),
      ).rejects.toThrow('409');
      expect(result.current.tickets).toHaveLength(1);
    });
  });

  describe('move', () => {
    it('204 の応答には新しい順位が無いので、一覧を取り直す', async () => {
      const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      hoisted.moveTicket.mockResolvedValue(undefined);
      hoisted.fetchTickets.mockClear();
      hoisted.fetchTickets.mockResolvedValue([ticket({ id: 't-1', number: 1, position: 'b0' })]);

      await act(async () => {
        await result.current.move('t-1', { anchorTicketId: 't-2', anchorAfter: true });
      });
      expect(hoisted.moveTicket).toHaveBeenCalledWith(SLUG, 't-1', { anchorTicketId: 't-2', anchorAfter: true });
      expect(hoisted.fetchTickets).toHaveBeenCalledTimes(1);
    });
  });

  describe('addLabel / removeLabel', () => {
    it('付けると手元のチケットの labels に足す（重複しては足さない）', async () => {
      const l1 = label({ id: 'l-1' });
      hoisted.addTicketLabel.mockResolvedValue(undefined);
      const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.addLabel('t-1', l1);
      });

      expect(result.current.tickets[0].labels).toEqual([l1]);
      expect(hoisted.addTicketLabel).toHaveBeenCalledWith(SLUG, 't-1', 'l-1');

      // 二重に付けても増えない。
      await act(async () => {
        await result.current.addLabel('t-1', l1);
      });
      expect(result.current.tickets[0].labels).toEqual([l1]);
    });

    it('外すと手元のチケットの labels から取り除く', async () => {
      hoisted.fetchTickets.mockResolvedValue([ticket({ id: 't-1', number: 1, labels: [label({ id: 'l-1' })] })]);
      hoisted.removeTicketLabel.mockResolvedValue(undefined);
      const { result } = renderHook(() => useTicketList(SLUG, SPACE, { archived: false }));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.removeLabel('t-1', 'l-1');
      });

      expect(result.current.tickets[0].labels).toEqual([]);
    });
  });
});
