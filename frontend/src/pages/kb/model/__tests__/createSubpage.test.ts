import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient } from '@/test/queryClient';
import { createSubpage, type SubpageEditor } from '../createSubpage';

const hoisted = vi.hoisted(() => ({
  createPage: vi.fn(),
}));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: { createPage: hoisted.createPage },
}));

const resolved = {
  workspaceSlug: 'w-3f2a9c',
  page: {
    id: 'parent-1',
    spaceId: 'space-1',
    title: '親ページ',
    createdByUserId: 1,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
  doc: { type: 'doc', content: [] },
  canEdit: true,
};

const child = {
  id: 'child-1',
  spaceId: 'space-1',
  parentId: 'parent-1',
  title: '無題',
  createdByUserId: 1,
  createdAt: '2026-08-28T00:00:00Z',
  updatedAt: '2026-08-28T00:00:00Z',
};

function fakeEditor() {
  const run = vi.fn();
  const insertContent = vi.fn(() => ({ run }));
  const editor: SubpageEditor = { chain: () => ({ focus: () => ({ insertContent }) }) };
  return { editor, insertContent, run };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.createPage.mockResolvedValue(child);
});

describe('createSubpage', () => {
  it('現在のページの子として作り、本文にページ参照を挿し、開く先の URL を返す', async () => {
    const { editor, insertContent, run } = fakeEditor();

    const path = await createSubpage(editor, resolved, createTestQueryClient());

    expect(hoisted.createPage).toHaveBeenCalledWith('w-3f2a9c', 'space-1', {
      title: '無題',
      parentId: 'parent-1',
    });
    // 参照は pageId を正として持ち、title は初回表示のための写し（正本はサーバーが解決）。
    expect(insertContent).toHaveBeenCalledWith({
      type: 'pageRef',
      attrs: { pageId: 'child-1', title: '無題' },
    });
    expect(run).toHaveBeenCalled();
    expect(path).toBe('/kb/child-1');
  });

  it('作ったページのスペースの木を取り直させる（左の列・すべてのページに出る）', async () => {
    const { editor } = fakeEditor();
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.pageTree('w-3f2a9c', 'space-1', false), { pages: [], hasHiddenChildren: false });
    client.setQueryData(kbKeys.pageTree('w-3f2a9c', 'space-2', false), { pages: [], hasHiddenChildren: false });

    await createSubpage(editor, resolved, client);

    expect(client.getQueryState(kbKeys.pageTree('w-3f2a9c', 'space-1', false))?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.pageTree('w-3f2a9c', 'space-2', false))?.isInvalidated).toBe(false);
  });

  it('作成に失敗したら参照を挿さず、木も取り直させず、失敗を投げる', async () => {
    hoisted.createPage.mockRejectedValue(new Error('403'));
    const { editor, insertContent } = fakeEditor();
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.pageTree('w-3f2a9c', 'space-1', false), { pages: [], hasHiddenChildren: false });

    await expect(createSubpage(editor, resolved, client)).rejects.toThrow();
    expect(insertContent).not.toHaveBeenCalled();
    expect(client.getQueryState(kbKeys.pageTree('w-3f2a9c', 'space-1', false))?.isInvalidated).toBe(false);
  });
});
