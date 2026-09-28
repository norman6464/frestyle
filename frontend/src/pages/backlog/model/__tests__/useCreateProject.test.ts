import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { projectKeys } from '@/entities/project/api/projectQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useCreateProject } from '../useCreateProject';

const hoisted = vi.hoisted(() => ({ createProject: vi.fn() }));

vi.mock('@/entities/project/api/projectRepository', () => ({
  ProjectRepository: { createProject: hoisted.createProject },
}));

const project = (id: string) => ({ id, workspaceId: 'w', key: id.toUpperCase(), name: id, createdAt: '', updatedAt: '' });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useCreateProject', () => {
  it('作ったプロジェクトを一覧へ足す（作った直後に移る先で見つかるように）', async () => {
    hoisted.createProject.mockResolvedValue(project('p-new'));
    const client = createTestQueryClient();
    client.setQueryData(projectKeys.list('acme'), [project('p-1')]);
    const { result } = renderHook(() => useCreateProject('acme'), { wrapper: queryWrapper(client) });

    const created = await result.current({ name: 'p-new' });

    expect(created.id).toBe('p-new');
    expect(client.getQueryData(projectKeys.list('acme'))).toEqual([project('p-1'), project('p-new')]);
  });

  it('失敗したら投げ、一覧は変えない', async () => {
    hoisted.createProject.mockRejectedValue(new Error('project_key_taken'));
    const client = createTestQueryClient();
    client.setQueryData(projectKeys.list('acme'), [project('p-1')]);
    const { result } = renderHook(() => useCreateProject('acme'), { wrapper: queryWrapper(client) });

    await expect(result.current({ name: 'x' })).rejects.toThrow('project_key_taken');
    expect(client.getQueryData(projectKeys.list('acme'))).toEqual([project('p-1')]);
  });
});
