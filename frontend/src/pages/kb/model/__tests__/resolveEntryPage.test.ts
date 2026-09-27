import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestQueryClient } from '@/test/queryClient';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { resolveEntryPageId } from '../resolveEntryPage';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchSpaces: vi.fn(),
  fetchPageTree: vi.fn(),
  getLastVisitedPageId: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    fetchWorkspaces: hoisted.fetchWorkspaces,
    fetchSpaces: hoisted.fetchSpaces,
    fetchPageTree: hoisted.fetchPageTree,
  },
}));

vi.mock('@/entities/kb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/kb')>();
  return { ...actual, getLastVisitedPageId: hoisted.getLastVisitedPageId };
});

function pageTree(pageIds: string[]) {
  return {
    pages: pageIds.map((id) => ({
      page: { id, spaceId: 's', title: id, createdByUserId: 1, createdAt: '', updatedAt: '' },
      children: [],
      hasHiddenChildren: false,
      parentArchived: false,
    })),
    hasHiddenChildren: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.getLastVisitedPageId.mockReturnValue(null);
});

describe('resolveEntryPageId', () => {
  it('workspaceSlug 指定があれば、直近の閲覧履歴より優先してその中の最初のページを返す', async () => {
    hoisted.getLastVisitedPageId.mockReturnValue('elsewhere');
    hoisted.fetchSpaces.mockResolvedValue([{ id: 'space-1', key: 's', name: '', visibility: 'workspace', createdAt: '' }]);
    hoisted.fetchPageTree.mockResolvedValue(pageTree(['p1', 'p2']));

    const result = await resolveEntryPageId(createTestQueryClient(), 'acme');

    expect(result).toEqual({ pageId: 'p1', fromLastVisited: false });
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
    expect(hoisted.fetchSpaces).toHaveBeenCalledWith('acme');
  });

  it('workspaceSlug が無ければ、直近に開いたページをそのまま返す(取りに行かない)', async () => {
    hoisted.getLastVisitedPageId.mockReturnValue('last-page');

    const result = await resolveEntryPageId(createTestQueryClient());

    expect(result).toEqual({ pageId: 'last-page', fromLastVisited: true });
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
  });

  it('閲覧履歴が無ければ、最初のワークスペース→最初のスペース→最初のページへ落ちる', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([{ slug: 'acme', name: '', createdAt: '', canManage: true }]);
    hoisted.fetchSpaces.mockResolvedValue([{ id: 'space-1', key: 's', name: '', visibility: 'workspace', createdAt: '' }]);
    hoisted.fetchPageTree.mockResolvedValue(pageTree(['p1']));

    const result = await resolveEntryPageId(createTestQueryClient());

    expect(result).toEqual({ pageId: 'p1', fromLastVisited: false });
  });

  it('ページが無いスペースは飛ばして次のスペースを見る', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([{ slug: 'acme', name: '', createdAt: '', canManage: true }]);
    hoisted.fetchSpaces.mockResolvedValue([
      { id: 'empty', key: 'e', name: '', visibility: 'workspace', createdAt: '' },
      { id: 'space-1', key: 's', name: '', visibility: 'workspace', createdAt: '' },
    ]);
    hoisted.fetchPageTree.mockImplementation((_slug: string, spaceId: string) =>
      Promise.resolve(spaceId === 'empty' ? pageTree([]) : pageTree(['p1'])),
    );

    const result = await resolveEntryPageId(createTestQueryClient());

    expect(result).toEqual({ pageId: 'p1', fromLastVisited: false });
  });

  it('どこにも 1 枚も無ければ null を返す', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([{ slug: 'acme', name: '', createdAt: '', canManage: true }]);
    hoisted.fetchSpaces.mockResolvedValue([{ id: 'space-1', key: 's', name: '', visibility: 'workspace', createdAt: '' }]);
    hoisted.fetchPageTree.mockResolvedValue(pageTree([]));

    const result = await resolveEntryPageId(createTestQueryClient());

    expect(result).toBeNull();
  });

  it('左の列が取ってあるワークスペースとスペースの一覧は取り直さない', async () => {
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.workspaces(), [{ slug: 'acme', name: '', createdAt: '', canManage: true }]);
    client.setQueryData(kbKeys.spaces('acme'), [
      { id: 'space-1', key: 's', name: '', visibility: 'workspace' as const, createdAt: '' },
    ]);
    hoisted.fetchPageTree.mockResolvedValue(pageTree(['p1']));

    const result = await resolveEntryPageId(client);

    expect(result).toEqual({ pageId: 'p1', fromLastVisited: false });
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
    expect(hoisted.fetchSpaces).not.toHaveBeenCalled();
  });

  it('所属ワークスペースが 1 つも無ければ null を返す', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([]);

    const result = await resolveEntryPageId(createTestQueryClient());

    expect(result).toBeNull();
    expect(hoisted.fetchSpaces).not.toHaveBeenCalled();
  });
});
