import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { projectKeys } from '@/entities/project/api/projectQueries';
import { useBacklogProject } from '../useBacklogProject';

const hoisted = vi.hoisted(() => ({ fetchWorkspaces: vi.fn(), fetchProjects: vi.fn(), resolveProject: vi.fn() }));

vi.mock('@/entities/workspace/api/workspaceRepository', () => ({
  default: { fetchWorkspaces: hoisted.fetchWorkspaces },
}));
vi.mock('@/entities/project/api/projectRepository', () => ({
  ProjectRepository: { fetchProjects: hoisted.fetchProjects, resolveProject: hoisted.resolveProject },
}));

const WS_A = { slug: 'a', name: 'A', createdAt: '', canManage: true };
const WS_B = { slug: 'b', name: 'B', createdAt: '', canManage: true };
const project = (id: string) => ({ id, workspaceId: 'w', key: id.toUpperCase(), name: id, createdAt: '', updatedAt: '' });

/** 所在の口の応答（/projects/:projectId）。 */
const LOCATIONS: Record<string, string> = { 'p-a': 'a', 'p-b': 'b' };
const notFound = () =>
  new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 404,
    statusText: 'Not Found',
    data: { error: 'not_found' },
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchWorkspaces.mockResolvedValue([WS_A, WS_B]);
  hoisted.fetchProjects.mockImplementation(async (slug: string) => (slug === 'a' ? [project('p-a')] : [project('p-b')]));
  hoisted.resolveProject.mockImplementation(async (projectId: string) => {
    const slug = LOCATIONS[projectId];
    if (!slug) throw notFound();
    return { workspaceSlug: slug, workspaceName: slug.toUpperCase(), project: project(projectId) };
  });
});

describe('useBacklogProject', () => {
  it('projectId の所在を口で引き、そのワークスペースの一覧だけからプロジェクトを読む', async () => {
    const { result } = renderHook(() => useBacklogProject('p-b', () => {}), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.project?.id).toBe('p-b'));
    expect(result.current.workspaceSlug).toBe('b');
    // 所属ワークスペースの一覧も、ほかのワークスペースのプロジェクトの一覧もたどらない。
    expect(hoisted.resolveProject).toHaveBeenCalledWith('p-b');
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
    expect(hoisted.fetchProjects.mock.calls.map(([slug]) => slug)).toEqual(['b']);
  });

  it('所在が 404 なら見つからない（読み込めなかったとは言わない）', async () => {
    const { result } = renderHook(() => useBacklogProject('p-9', () => {}), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(hoisted.fetchProjects).not.toHaveBeenCalled();
  });

  it('所在が分かっても一覧に無ければ見つからない', async () => {
    hoisted.fetchProjects.mockResolvedValue([]);
    const { result } = renderHook(() => useBacklogProject('p-a', () => {}), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.notFound).toBe(true));
    expect(result.current.error).toBeNull();
  });

  it('所在を読み込めなかったら、取り直して続きを出せる', async () => {
    hoisted.resolveProject.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useBacklogProject('p-a', () => {}), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.notFound).toBe(false);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.project?.id).toBe('p-a'));
    expect(result.current.error).toBeNull();
  });

  it('一覧を読み込めなかったら、取り直して続きを出せる（読めていた所在は取り直さない）', async () => {
    hoisted.fetchProjects.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useBacklogProject('p-a', () => {}), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.project?.id).toBe('p-a'));
    expect(hoisted.resolveProject).toHaveBeenCalledTimes(1);
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

  it('取ってある所在と一覧（プロジェクトの切替などが取った）を使い、画面を移るたびに取り直さない', async () => {
    const client = createTestQueryClient();
    client.setQueryData(projectKeys.location('p-a'), { workspaceSlug: 'a', workspaceName: 'A', project: project('p-a') });
    client.setQueryData(projectKeys.list('a'), [project('p-a')]);
    const { result } = renderHook(() => useBacklogProject('p-a', () => {}), { wrapper: queryWrapper(client) });

    await waitFor(() => expect(result.current.project?.id).toBe('p-a'));
    expect(hoisted.resolveProject).not.toHaveBeenCalled();
    expect(hoisted.fetchProjects).not.toHaveBeenCalled();
    expect(hoisted.fetchWorkspaces).not.toHaveBeenCalled();
  });
});
