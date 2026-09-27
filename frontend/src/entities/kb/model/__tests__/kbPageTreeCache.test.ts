import { describe, it, expect } from 'vitest';
import { createTestQueryClient } from '@/test/queryClient';
import { kbKeys } from '../../api/kbQueries';
import { refreshKbPageTrees, reflectKbPageInTrees } from '../kbPageTreeCache';

const page = { id: 'p-1', spaceId: 's-1', title: '新しい題名', createdByUserId: 1, createdAt: '', updatedAt: '' };

function seeded() {
  const client = createTestQueryClient();
  client.setQueryData(kbKeys.pageTree('acme', 's-1', false), { pages: [], hasHiddenChildren: false });
  client.setQueryData(kbKeys.favorites('acme'), []);
  client.setQueryData(kbKeys.favorites('other'), []);
  client.setQueryData(kbKeys.recentPages(), []);
  return client;
}

describe('refreshKbPageTrees', () => {
  it('そのスペースの木と、ページを載せている一覧（お気に入り・最近のページ）を古いものにする', async () => {
    const client = seeded();

    await refreshKbPageTrees(client, 'acme', 's-1');

    expect(client.getQueryState(kbKeys.pageTree('acme', 's-1', false))?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.favorites('acme'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.recentPages())?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.favorites('other'))?.isInvalidated).toBe(false);
  });
});

describe('reflectKbPageInTrees', () => {
  it('題名などが変わったら、お気に入り・最近のページも古いものにする（そこにも題名が出る）', async () => {
    const client = seeded();

    await reflectKbPageInTrees(client, 'acme', page);

    expect(client.getQueryState(kbKeys.favorites('acme'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.recentPages())?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.favorites('other'))?.isInvalidated).toBe(false);
  });
});
