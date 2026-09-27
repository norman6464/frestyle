import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useWorkspaceList } from '../useWorkspaceList';
import { subscribeKbTreeEvents } from '../kbTreeEvents';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { kbKeys } from '../../api/kbQueries';
import { ticketKeys } from '@/entities/ticket/api/ticketQueries';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  createWorkspace: vi.fn(),
  deleteWorkspace: vi.fn(),
}));

vi.mock('../../api/kbRepository', () => ({
  default: {
    fetchWorkspaces: hoisted.fetchWorkspaces,
    createWorkspace: hoisted.createWorkspace,
    deleteWorkspace: hoisted.deleteWorkspace,
  },
}));

const WS_A = { slug: 'a', name: 'A', createdAt: '' };
const WS_B = { slug: 'b', name: 'B', createdAt: '' };

describe('useWorkspaceList', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.fetchWorkspaces.mockResolvedValue([WS_A]);
  });

  it('マウント時に一覧を読み込む', async () => {
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.workspaces).toEqual([WS_A]);
    expect(result.current.error).toBeNull();
  });

  it('読み込みに失敗するとエラーを返す', async () => {
    hoisted.fetchWorkspaces.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('ワークスペースを読み込めませんでした');
  });

  it('作ったワークスペースを一覧へ足す', async () => {
    hoisted.createWorkspace.mockResolvedValue(WS_B);
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createWorkspace({ name: 'B' });
    });

    await waitFor(() => expect(result.current.workspaces).toEqual([WS_A, WS_B]));
  });

  it('消したワークスペースを一覧から外す', async () => {
    hoisted.deleteWorkspace.mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteWorkspace('a');
    });

    await waitFor(() => expect(result.current.workspaces).toEqual([]));
  });

  it('retry で読み直せる', async () => {
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.fetchWorkspaces.mockResolvedValueOnce([WS_A, WS_B]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.workspaces).toEqual([WS_A, WS_B]));
  });

  // SecondaryPanel はモバイル用/デスクトップ用の DOM を常に両方マウントするため、
  // 左の列（useKbTree）・管理の画面・ホームは、同じ鍵の結果を共有する。片方で作った・消した
  // ワークスペースは、知らせを待たずにもう片方の一覧にも出る。
  it('同じキャッシュを使うほかの場所で作ったワークスペースが、一覧に出る', async () => {
    hoisted.createWorkspace.mockResolvedValue(WS_B);
    const client = createTestQueryClient();
    const { result } = renderHook(() => ({ here: useWorkspaceList(), there: useWorkspaceList() }), {
      wrapper: queryWrapper(client),
    });
    await waitFor(() => expect(result.current.here.loading).toBe(false));

    await act(async () => {
      await result.current.there.createWorkspace({ name: 'B' });
    });

    await waitFor(() => expect(result.current.here.workspaces).toEqual([WS_A, WS_B]));
    expect(hoisted.fetchWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('同じキャッシュを使うほかの場所で消したワークスペースが、一覧から外れる', async () => {
    hoisted.deleteWorkspace.mockResolvedValue(undefined);
    const client = createTestQueryClient();
    const { result } = renderHook(() => ({ here: useWorkspaceList(), there: useWorkspaceList() }), {
      wrapper: queryWrapper(client),
    });
    await waitFor(() => expect(result.current.here.loading).toBe(false));

    await act(async () => {
      await result.current.there.deleteWorkspace('a');
    });

    await waitFor(() => expect(result.current.here.workspaces).toEqual([]));
  });

  it('消したワークスペースの中のもの（スペースの一覧）を控えに残さない', async () => {
    hoisted.deleteWorkspace.mockResolvedValue(undefined);
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.spaces('a'), [{ id: 'sp-1', name: 'S', workspaceSlug: 'a' }]);
    client.setQueryData(kbKeys.spaces('b'), [{ id: 'sp-2', name: 'T', workspaceSlug: 'b' }]);
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteWorkspace('a');
    });

    expect(client.getQueryData(kbKeys.spaces('a'))).toBeUndefined();
    expect(client.getQueryData(kbKeys.spaces('b'))).toBeDefined();
  });

  it('消したワークスペースのチケットの設定（ラベル・状態）も控えに残さない', async () => {
    hoisted.deleteWorkspace.mockResolvedValue(undefined);
    const client = createTestQueryClient();
    client.setQueryData(ticketKeys.labels('a'), []);
    client.setQueryData(ticketKeys.statuses('a', 'p-1'), []);
    client.setQueryData(ticketKeys.labels('b'), []);
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteWorkspace('a');
    });

    expect(client.getQueryData(ticketKeys.labels('a'))).toBeUndefined();
    expect(client.getQueryData(ticketKeys.statuses('a', 'p-1'))).toBeUndefined();
    expect(client.getQueryData(ticketKeys.labels('b'))).toBeDefined();
  });

  it('消すと workspace-deleted を知らせる（開いているページの画面が一覧へ戻るため）', async () => {
    hoisted.deleteWorkspace.mockResolvedValue(undefined);
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const listener = vi.fn();
    const unsubscribe = subscribeKbTreeEvents(listener);

    await act(async () => {
      await result.current.deleteWorkspace('a');
    });

    expect(listener).toHaveBeenCalledWith({ type: 'workspace-deleted', workspaceSlug: 'a' });
    unsubscribe();
  });

  it('一覧を持っているうちの取り直しに失敗しても、持っている一覧を出し続ける', async () => {
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.fetchWorkspaces.mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.retry());
    await waitFor(() => expect(hoisted.fetchWorkspaces).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.workspaces).toEqual([WS_A]);
    expect(result.current.error).toBeNull();
  });

  it('一覧を持っているうちは、失敗のあとの取り直しの間も読み込み中にしない（中身を差し替えない）', async () => {
    const { result } = renderHook(() => useWorkspaceList(), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.fetchWorkspaces.mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.retry());
    await waitFor(() => expect(hoisted.fetchWorkspaces).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.fetchWorkspaces.mockImplementationOnce(() => new Promise(() => {}));
    act(() => result.current.retry());
    await waitFor(() => expect(hoisted.fetchWorkspaces).toHaveBeenCalledTimes(3));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.loading).toBe(false);
    expect(result.current.workspaces).toEqual([WS_A]);
  });
});
