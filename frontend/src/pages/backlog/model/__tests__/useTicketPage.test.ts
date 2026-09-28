import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketKeys, type Label, type Ticket, type TicketPermission } from '@/entities/ticket';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useTicketPage } from '../useTicketPage';

const hoisted = vi.hoisted(() => ({
  resolveTicket: vi.fn(),
  updateTicket: vi.fn(),
  changeTicketStatus: vi.fn(),
  assignTicket: vi.fn(),
  unassignTicket: vi.fn(),
  archiveTicket: vi.fn(),
  restoreTicket: vi.fn(),
  changeTicketParent: vi.fn(),
  fetchProject: vi.fn(),
  addTicketLabel: vi.fn(),
  removeTicketLabel: vi.fn(),
}));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: {
    resolveTicket: hoisted.resolveTicket,
    updateTicket: hoisted.updateTicket,
    changeTicketStatus: hoisted.changeTicketStatus,
    assignTicket: hoisted.assignTicket,
    unassignTicket: hoisted.unassignTicket,
    archiveTicket: hoisted.archiveTicket,
    restoreTicket: hoisted.restoreTicket,
    changeTicketParent: hoisted.changeTicketParent,
    addTicketLabel: hoisted.addTicketLabel,
    removeTicketLabel: hoisted.removeTicketLabel,
  },
}));

vi.mock('@/entities/project/api/projectRepository', () => ({
  ProjectRepository: { fetchProject: hoisted.fetchProject },
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

const permission: TicketPermission = { canView: true, canComment: true, canEdit: true, canManage: false };

function ticket(over: Partial<Ticket> = {}): Ticket {
  return {
    id: 't-1',
    workspaceId: 'w-1',
    projectId: 's-1',
    number: 12,
    typeId: 'ty-1',
    statusId: 'st-1',
    parentId: null,
    title: '本文',
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

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchProject.mockResolvedValue({ id: 'p-1', key: 'FRESTYLE', name: 'FreStyle' });
});

describe('useTicketPage', () => {
  it('解決してワークスペース・チケット・祖先・権限・プロジェクトを持つ', async () => {
    hoisted.resolveTicket.mockResolvedValue({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket(),
      canEdit: true,
      ancestors: [],
      permission,
    });

    const { result } = renderHook(() => useTicketPage('t-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workspaceSlug).toBe('acme');
    expect(result.current.ticket?.id).toBe('t-1');
    expect(result.current.permission).toEqual(permission);
    expect(result.current.project?.key).toBe('FRESTYLE');
  });

  it('404はチケットが見つからない文言、それ以外は読み込み失敗の文言', async () => {
    hoisted.resolveTicket.mockRejectedValueOnce(httpError(404));
    const notFound = renderHook(() => useTicketPage('t-404'));
    await waitFor(() => expect(notFound.result.current.error).toBe('チケットが見つかりませんでした。'));

    hoisted.resolveTicket.mockRejectedValueOnce(httpError(500));
    const failed = renderHook(() => useTicketPage('t-500'));
    await waitFor(() =>
      expect(failed.result.current.error).toBe(
        'チケットを開けませんでした。時間をおいて開き直すと最新の状態が出ます。',
      ),
    );
  });

  it('プロジェクトが引けなくてもチケットは表示する（キーだけ出ない）', async () => {
    hoisted.resolveTicket.mockResolvedValue({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket(),
      canEdit: true,
      ancestors: [],
      permission,
    });
    hoisted.fetchProject.mockRejectedValue(new Error('network'));

    const { result } = renderHook(() => useTicketPage('t-1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.ticket?.id).toBe('t-1');
    expect(result.current.project).toBeNull();
  });

  it('宛先を切り替えたら古い応答を無視する', async () => {
    let resolveFirst!: (v: unknown) => void;
    hoisted.resolveTicket.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    hoisted.resolveTicket.mockResolvedValueOnce({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket({ id: 't-2', title: '2件目' }),
      canEdit: true,
      ancestors: [],
      permission,
    });

    const { result, rerender } = renderHook(({ id }) => useTicketPage(id), { initialProps: { id: 't-1' } });
    rerender({ id: 't-2' });

    await waitFor(() => expect(result.current.ticket?.id).toBe('t-2'));

    resolveFirst({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket({ id: 't-1', title: '1件目（古い）' }),
      canEdit: true,
      ancestors: [],
      permission,
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.ticket?.id).toBe('t-2');
  });

  it('204で本体が返らない担当解除は手元で外す', async () => {
    hoisted.resolveTicket.mockResolvedValue({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket({ assigneePrincipalId: 'p-1' }),
      canEdit: true,
      ancestors: [],
      permission,
    });
    hoisted.unassignTicket.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketPage('t-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.unassign();
    });

    // 置き場の知らせは次の刻みで届くので、映るのを待つ。
    await waitFor(() => expect(result.current.ticket?.assigneePrincipalId).toBeNull());
  });

  it('書き込みの失敗は投げ直し、busyを戻す', async () => {
    hoisted.resolveTicket.mockResolvedValue({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket(),
      canEdit: true,
      ancestors: [],
      permission,
    });
    hoisted.archiveTicket.mockRejectedValue(new Error('403'));

    const { result } = renderHook(() => useTicketPage('t-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.archive();
      }),
    ).rejects.toThrow('403');
    expect(result.current.busy).toBe(false);
  });

  it('親を変えると祖先が変わりうるので取り直す（部分差し替えしない）', async () => {
    hoisted.resolveTicket
      .mockResolvedValueOnce({
        workspaceSlug: 'acme',
        workspaceName: 'Acme',
        ticket: ticket({ parentId: null }),
        canEdit: true,
        ancestors: [],
        permission,
      })
      .mockResolvedValueOnce({
        workspaceSlug: 'acme',
        workspaceName: 'Acme',
        ticket: ticket({ parentId: 'p-1' }),
        canEdit: true,
        ancestors: [ticket({ id: 'p-1', title: '親' })],
        permission,
      });
    hoisted.changeTicketParent.mockResolvedValue(ticket({ parentId: 'p-1' }));

    const { result } = renderHook(() => useTicketPage('t-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.ancestors).toEqual([]);

    await act(async () => {
      await result.current.changeParent('p-1');
    });

    expect(hoisted.changeTicketParent).toHaveBeenCalledWith('acme', 't-1', 'p-1');
    expect(hoisted.resolveTicket).toHaveBeenCalledTimes(2);
    expect(result.current.ancestors).toHaveLength(1);
  });
});

describe('共有の控えとのやりとり', () => {
  const resolvedOf = (over: Partial<Ticket> = {}, ancestors: Ticket[] = []) => ({
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    ticket: ticket(over),
    canEdit: true,
    ancestors,
    permission,
  });

  it('書き込みの応答はバックログの一覧の控えにも映し、件数を古いものにする', async () => {
    const client = createTestQueryClient();
    const listKey = ticketKeys.list('acme', 's-1', {});
    client.setQueryData(listKey, [ticket({ title: '古い題名' }), ticket({ id: 't-9' })]);
    client.setQueryData(ticketKeys.counts('acme', 's-1'), { all: 2 });
    hoisted.resolveTicket.mockResolvedValue(resolvedOf({ title: '古い題名' }));
    hoisted.updateTicket.mockResolvedValue(ticket({ title: '新しい題名' }));

    const { result } = renderHook(() => useTicketPage('t-1'), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateTicket({ title: '新しい題名' });
    });

    await waitFor(() => expect(result.current.ticket?.title).toBe('新しい題名'));
    expect(client.getQueryData<Ticket[]>(listKey)?.map((t) => t.title)).toEqual(['新しい題名', '本文']);
    expect(client.getQueryState(ticketKeys.counts('acme', 's-1'))?.isInvalidated).toBe(true);
  });

  it('親を変えても読み込み中に戻さず、出したまま祖先を取り直す', async () => {
    // 祖先の取り直しを止めておき、その間の画面を確かめる。
    let finishRefetch!: (value: unknown) => void;
    hoisted.resolveTicket
      .mockResolvedValueOnce(resolvedOf({ parentId: null }))
      .mockImplementationOnce(() => new Promise((resolve) => (finishRefetch = resolve)));
    hoisted.changeTicketParent.mockResolvedValue(ticket({ parentId: 'p-1' }));

    const { result } = renderHook(() => useTicketPage('t-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let done!: Promise<void>;
    act(() => {
      done = result.current.changeParent('p-1');
    });
    await waitFor(() => expect(hoisted.resolveTicket).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.ticket?.parentId).toBe('p-1'));
    // 取り直している間も、チケットは出したまま・読み込み中に戻さない（画面を組み直さない）。
    expect(result.current.loading).toBe(false);

    await act(async () => {
      finishRefetch(resolvedOf({ parentId: 'p-1' }, [ticket({ id: 'p-1', title: '親' })]));
      await done;
    });
    await waitFor(() => expect(result.current.ancestors.map((a) => a.id)).toEqual(['p-1']));
  });

  it('取り直しで見る立場を失ったら（404）、出していたチケットも下げて見つからない文言にする', async () => {
    hoisted.resolveTicket.mockResolvedValueOnce(resolvedOf()).mockRejectedValueOnce(httpError(404));

    const { result } = renderHook(() => useTicketPage('t-1'));
    await waitFor(() => expect(result.current.ticket?.id).toBe('t-1'));

    act(() => result.current.refresh());

    await waitFor(() => expect(result.current.error).toBe('チケットが見つかりませんでした。'));
    expect(result.current.ticket).toBeNull();
  });
});

describe('addLabel / removeLabel', () => {
  const permission: TicketPermission = { canView: true, canComment: true, canEdit: true, canManage: false };
  const label = (over: Partial<Label> & { id: string }): Label => ({
    projectId: 's-1',
    name: 'ラベル',
    color: '#1d4ed8',
    createdAt: '',
    updatedAt: '',
    ...over,
  });

  it('付けると手元の labels に足す（重複しては足さない）', async () => {
    hoisted.resolveTicket.mockResolvedValue({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket(),
      canEdit: true,
      ancestors: [],
      permission,
    });
    hoisted.addTicketLabel.mockResolvedValue(undefined);
    const l1 = label({ id: 'l-1' });

    const { result } = renderHook(() => useTicketPage('t-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.addLabel(l1);
    });
    await waitFor(() => expect(result.current.ticket?.labels).toEqual([l1]));
    expect(hoisted.addTicketLabel).toHaveBeenCalledWith('acme', 't-1', 'l-1');

    await act(async () => {
      await result.current.addLabel(l1);
    });
    expect(result.current.ticket?.labels).toEqual([l1]);
  });

  it('外すと手元の labels から取り除く', async () => {
    hoisted.resolveTicket.mockResolvedValue({
      workspaceSlug: 'acme',
      workspaceName: 'Acme',
      ticket: ticket({ labels: [label({ id: 'l-1' })] }),
      canEdit: true,
      ancestors: [],
      permission,
    });
    hoisted.removeTicketLabel.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketPage('t-1'));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.removeLabel('l-1');
    });
    await waitFor(() => expect(result.current.ticket?.labels).toEqual([]));
  });
});
