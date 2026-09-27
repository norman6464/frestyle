import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveEntryPageId } from '../resolveEntryPage';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchSpaces: vi.fn(),
  fetchPageTree: vi.fn(),
  getLastVisitedPageId: vi.fn(),
}));

vi.mock('@/entities/kb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/kb')>();
  return {
    ...actual,
    KbRepository: {
      fetchWorkspaces: hoisted.fetchWorkspaces,
      fetchSpaces: hoisted.fetchSpaces,
      fetchPageTree: hoisted.fetchPageTree,
    },
    getLastVisitedPageId: hoisted.getLastVisitedPageId,
  };
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

    const result = await resolveEntryPageId('acme');

    expect(result).toEqual({ pageId: 'p1', fromLastVisited: false });
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
    expect(hoisted.fetchSpaces).toHaveBeenCalledWith('acme');
  });

  it('workspaceSlug が無ければ、直近に開いたページをそのまま返す(取りに行かない)', async () => {
    hoisted.getLastVisitedPageId.mockReturnValue('last-page');

    const result = await resolveEntryPageId();

    expect(result).toEqual({ pageId: 'last-page', fromLastVisited: true });
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
  });

  it('閲覧履歴が無ければ、最初のワークスペース→最初のスペース→最初のページへ落ちる', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([{ slug: 'acme', name: '', createdAt: '', canManage: true }]);
    hoisted.fetchSpaces.mockResolvedValue([{ id: 'space-1', key: 's', name: '', visibility: 'workspace', createdAt: '' }]);
    hoisted.fetchPageTree.mockResolvedValue(pageTree(['p1']));

    const result = await resolveEntryPageId();

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

    const result = await resolveEntryPageId();

    expect(result).toEqual({ pageId: 'p1', fromLastVisited: false });
  });

  it('どこにも 1 枚も無ければ null を返す', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([{ slug: 'acme', name: '', createdAt: '', canManage: true }]);
    hoisted.fetchSpaces.mockResolvedValue([{ id: 'space-1', key: 's', name: '', visibility: 'workspace', createdAt: '' }]);
    hoisted.fetchPageTree.mockResolvedValue(pageTree([]));

    const result = await resolveEntryPageId();

    expect(result).toBeNull();
  });

  it('所属ワークスペースが 1 つも無ければ null を返す', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([]);

    const result = await resolveEntryPageId();

    expect(result).toBeNull();
    expect(hoisted.fetchSpaces).not.toHaveBeenCalled();
  });
});
