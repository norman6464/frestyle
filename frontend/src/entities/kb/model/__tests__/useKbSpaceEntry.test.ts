import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { kbKeys } from '../../api/kbQueries';
import { useKbSpaceEntry } from '../useKbSpaceEntry';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchMySpaces: vi.fn(),
}));

vi.mock('../../api/kbRepository', () => ({
  default: { fetchMySpaces: hoisted.fetchMySpaces },
}));
vi.mock('@/entities/workspace/api/workspaceRepository', () => ({
  default: { fetchWorkspaces: hoisted.fetchWorkspaces },
}));

const WS_A = { slug: 'a', name: 'A', createdAt: '', canManage: true };
const WS_B = { slug: 'b', name: 'B', createdAt: '', canManage: false };
const SPACE_A1 = { id: 'sp-a1', name: 'A のスペース', role: 'admin' as const };
const SPACE_B1 = { id: 'sp-b1', name: 'B のスペース', role: 'viewer' as const };

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
  hoisted.fetchMySpaces.mockImplementation(async (slug: string) => (slug === 'a' ? [SPACE_A1] : [SPACE_B1]));
});

describe('useKbSpaceEntry', () => {
  it('spaceId からワークスペースを引く', async () => {
    const { result } = renderHook(() => useKbSpaceEntry('sp-b1', () => {}), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.space).toEqual(SPACE_B1));
    expect(result.current.workspaceSlug).toBe('b');
    expect(result.current.loading).toBe(false);
  });

  it('見つからないことと、読み込めなかったことを分けて返す', async () => {
    const { result } = renderHook(() => useKbSpaceEntry('space-9', () => {}), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('読み込めなかったら、取り直して続きを出せる', async () => {
    hoisted.fetchMySpaces.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useKbSpaceEntry('sp-a1', () => {}), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.notFound).toBe(false);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.space?.id).toBe('sp-a1'));
    expect(result.current.error).toBeNull();
    // 読めていた一覧（b）は取り直さない。
    expect(hoisted.fetchMySpaces.mock.calls.filter(([slug]) => slug === 'b')).toHaveLength(1);
  });

  it('入口（spaceId 無し）では、最初のスペースへ移す', async () => {
    const onResolved = vi.fn();
    const { result } = renderHook(() => useKbSpaceEntry(undefined, onResolved), { wrapper: queryWrapper() });

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('sp-a1'));
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(true);
  });

  it('入口では、持ち越したワークスペースを先に見る', async () => {
    const onResolved = vi.fn();
    renderHook(() => useKbSpaceEntry(undefined, onResolved, 'b'), { wrapper: queryWrapper() });

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('sp-b1'));
  });

  it('入口で、どのワークスペースにもスペースが無ければそう返す', async () => {
    hoisted.fetchMySpaces.mockResolvedValue([]);
    const onResolved = vi.fn();
    const { result } = renderHook(() => useKbSpaceEntry(undefined, onResolved), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.noSpaces).toBe(true));
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('入口（spaceId 無し）で読み込めなかったときも取り直せる', async () => {
    hoisted.fetchWorkspaces.mockRejectedValueOnce(new Error('network'));
    const onResolved = vi.fn();
    const { result } = renderHook(() => useKbSpaceEntry(undefined, onResolved), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('sp-a1'));
  });

  it('ほかの場所がスペースを改名したら、名前がそのまま届く', async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(() => useKbSpaceEntry('sp-a1', () => {}), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.space?.name).toBe('A のスペース'));

    act(() => {
      client.setQueryData(kbKeys.mySpaces('a'), [{ ...SPACE_A1, name: '新しい名前' }]);
    });

    await waitFor(() => expect(result.current.space?.name).toBe('新しい名前'));
  });
});
