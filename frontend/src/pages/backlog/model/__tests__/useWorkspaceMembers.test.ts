import { renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useWorkspaceMembers } from '../useWorkspaceMembers';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const hoisted = vi.hoisted(() => ({
  fetchMembers: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の WorkspaceRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/workspace/api/workspaceRepository', () => ({
  default: { fetchMembers: hoisted.fetchMembers },
}));

const SLUG = 'acme';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useWorkspaceMembers', () => {
  it('宛先が揃ったら取得する', async () => {
    hoisted.fetchMembers.mockResolvedValue([{ principalId: 'p-1', userId: 1, name: '田中 太郎' }]);
    const { result } = renderHook(() => useWorkspaceMembers(SLUG));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.members).toHaveLength(1);
    expect(hoisted.fetchMembers).toHaveBeenCalledWith(SLUG);
  });

  it('取得失敗は文言を出す', async () => {
    hoisted.fetchMembers.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useWorkspaceMembers(SLUG));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  // チケットの発言欄と属性の欄は、同じワークスペースの人を使う。
  it('同じワークスペースの人は 1 回だけ取る', async () => {
    hoisted.fetchMembers.mockResolvedValue([{ principalId: 'p-1', userId: 1, name: '田中 太郎' }]);
    const client = createTestQueryClient();
    const { result } = renderHook(() => ({ here: useWorkspaceMembers(SLUG), there: useWorkspaceMembers(SLUG) }), {
      wrapper: queryWrapper(client),
    });
    await waitFor(() => expect(result.current.there.members).toHaveLength(1));
    expect(hoisted.fetchMembers).toHaveBeenCalledTimes(1);
  });

  it('宛先が揃っていなければ何もしない', () => {
    const { result } = renderHook(() => useWorkspaceMembers(undefined));
    expect(result.current.members).toEqual([]);
    expect(hoisted.fetchMembers).not.toHaveBeenCalled();
  });
});
