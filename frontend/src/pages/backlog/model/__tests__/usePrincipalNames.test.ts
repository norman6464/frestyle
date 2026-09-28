import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { usePrincipalNames } from '../usePrincipalNames';

const hoisted = vi.hoisted(() => ({ fetchSpaces: vi.fn(), fetchPageTree: vi.fn(), listGrantablePrincipals: vi.fn() }));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    fetchSpaces: hoisted.fetchSpaces,
    fetchPageTree: hoisted.fetchPageTree,
    listGrantablePrincipals: hoisted.listGrantablePrincipals,
  },
}));

const space = (id: string) => ({ id, key: id, name: id, visibility: 'workspace' as const, createdAt: '' });
const tree = (pageIds: string[]) => ({
  pages: pageIds.map((id) => ({
    page: { id, spaceId: 's', title: id, createdByUserId: 1, createdAt: '', updatedAt: '' },
    children: [],
    hasHiddenChildren: false,
    parentArchived: false,
  })),
  hasHiddenChildren: false,
});
const PRINCIPALS = [{ id: 'pr-1', kind: 'user', name: '田中 太郎' }];

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchSpaces.mockResolvedValue([space('empty'), space('s-1')]);
  hoisted.fetchPageTree.mockImplementation(async (_slug: string, spaceId: string) =>
    spaceId === 'empty' ? tree([]) : tree(['p-1']),
  );
  hoisted.listGrantablePrincipals.mockResolvedValue(PRINCIPALS);
});

describe('usePrincipalNames', () => {
  it('ページのある最初のスペースの最初のページで代表させ、名前と頭文字を引く', async () => {
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.nameOf('pr-1')).toBe('田中 太郎'));
    expect(hoisted.listGrantablePrincipals).toHaveBeenCalledWith('acme', 'p-1');
    expect(result.current.initialsOf('pr-9zz')).toBe('PR');
  });

  it('どのスペースにもページが無ければ空のまま', async () => {
    hoisted.fetchPageTree.mockResolvedValue(tree([]));
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.principals).toEqual([]);
    expect(hoisted.listGrantablePrincipals).not.toHaveBeenCalled();
  });

  it('左の列が取ってあるスペースの一覧と木を使い、取り直さない', async () => {
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.spaces('acme'), [space('s-1')]);
    client.setQueryData(kbKeys.pageTree('acme', 's-1', false), tree(['p-1']));
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper(client) });

    await waitFor(() => expect(result.current.principals).toEqual(PRINCIPALS));
    expect(hoisted.fetchSpaces).not.toHaveBeenCalled();
    expect(hoisted.fetchPageTree).not.toHaveBeenCalled();
  });

  it('引けなくても落ちず、空のまま', async () => {
    hoisted.fetchSpaces.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.principals).toEqual([]);
    expect(result.current.nameOf('pr-1')).toBe('');
  });
});
