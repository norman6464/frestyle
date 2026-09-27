import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useKbSpaceAllPages } from '../useKbSpaceAllPages';

const hoisted = vi.hoisted(() => ({ fetchPageTree: vi.fn() }));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: { fetchPageTree: hoisted.fetchPageTree },
}));

function node(id: string, children: ReturnType<typeof node>[] = []) {
  return {
    page: { id, spaceId: 'space-1', title: id, createdByUserId: 1, createdAt: '', updatedAt: '' },
    children,
    hasHiddenChildren: false,
    parentArchived: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchPageTree.mockResolvedValue({ pages: [node('p1', [node('p1-1')]), node('p2')], hasHiddenChildren: false });
});

describe('useKbSpaceAllPages', () => {
  it('木を親の直後に子が並ぶ一覧に開く', async () => {
    const { result } = renderHook(() => useKbSpaceAllPages('acme', 'space-1'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pages.map((p) => [p.page.id, p.depth])).toEqual([
      ['p1', 0],
      ['p1-1', 1],
      ['p2', 0],
    ]);
    expect(hoisted.fetchPageTree).toHaveBeenCalledWith('acme', 'space-1', { archived: false });
  });

  it('読み込めなかったら理由を出し、取り直せる', async () => {
    hoisted.fetchPageTree.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useKbSpaceAllPages('acme', 'space-1'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.pages).toHaveLength(3));
    expect(result.current.error).toBeNull();
  });

  it('左の列が取ってある木を使い、取り直さない', async () => {
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.pageTree('acme', 'space-1', false), { pages: [node('p9')], hasHiddenChildren: true });
    const { result } = renderHook(() => useKbSpaceAllPages('acme', 'space-1'), { wrapper: queryWrapper(client) });

    await waitFor(() => expect(result.current.pages.map((p) => p.page.id)).toEqual(['p9']));
    expect(result.current.hasHiddenChildren).toBe(true);
    expect(hoisted.fetchPageTree).not.toHaveBeenCalled();
  });
});
