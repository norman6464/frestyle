import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { projectKeys } from '@/entities/project/api/projectQueries';
import { useBacklogProject } from '../useBacklogProject';

const hoisted = vi.hoisted(() => ({ fetchWorkspaces: vi.fn(), fetchProjects: vi.fn() }));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: { fetchWorkspaces: hoisted.fetchWorkspaces },
}));
vi.mock('@/entities/project/api/projectRepository', () => ({
  ProjectRepository: { fetchProjects: hoisted.fetchProjects },
}));

const WS_A = { slug: 'a', name: 'A', createdAt: '', canManage: true };
const WS_B = { slug: 'b', name: 'B', createdAt: '', canManage: true };
const project = (id: string) => ({ id, workspaceId: 'w', key: id.toUpperCase(), name: id, createdAt: '', updatedAt: '' });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
  hoisted.fetchProjects.mockImplementation(async (slug: string) => (slug === 'a' ? [project('p-a')] : [project('p-b')]));
});

describe('useBacklogProject', () => {
  it('projectId からワークスペースを引く', async () => {
    const { result } = renderHook(() => useBacklogProject('p-b', () => {}), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.project?.id).toBe('p-b'));
    expect(result.current.workspaceSlug).toBe('b');
  });

  it('見つからないことと、読み込めなかったことを分けて返す', async () => {
    const { result } = renderHook(() => useBacklogProject('p-9', () => {}), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('読み込めなかったら、読めなかった一覧だけを取り直して続きを出せる', async () => {
    hoisted.fetchProjects.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useBacklogProject('p-a', () => {}), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.notFound).toBe(false);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.project?.id).toBe('p-a'));
    expect(hoisted.fetchProjects.mock.calls.filter(([slug]) => slug === 'b')).toHaveLength(1);
  });

  it('入口（projectId 無し）では、所属の先頭から最初のプロジェクトへ移す', async () => {
    const onResolved = vi.fn();
    renderHook(() => useBacklogProject(undefined, onResolved), { wrapper: queryWrapper() });

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('p-a'));
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('入口で、どのワークスペースにもプロジェクトが無ければそう返す', async () => {
    hoisted.fetchProjects.mockResolvedValue([]);
    const { result } = renderHook(() => useBacklogProject(undefined, vi.fn()), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.noProjects).toBe(true));
  });

  it('入口（projectId 無し）で読み込めなかったときも取り直せる', async () => {
    hoisted.fetchWorkspaces.mockRejectedValueOnce(new Error('network'));
    const onResolved = vi.fn();
    const { result } = renderHook(() => useBacklogProject(undefined, onResolved), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('p-a'));
  });

  it('プロジェクトの切替などで取ってある一覧を使い、画面を移るたびに取り直さない', async () => {
    const client = createTestQueryClient();
    client.setQueryData(['workspaces'], [WS_A]);
    client.setQueryData(projectKeys.list('a'), [project('p-a')]);
    const { result } = renderHook(() => useBacklogProject('p-a', () => {}), { wrapper: queryWrapper(client) });

    await waitFor(() => expect(result.current.project?.id).toBe('p-a'));
    expect(hoisted.fetchProjects).not.toHaveBeenCalled();
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
  });
});
