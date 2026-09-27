import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useBacklogProject } from '../useBacklogProject';

const hoisted = vi.hoisted(() => ({
  resolveBacklogProject: vi.fn(),
  resolveEntryProjectId: vi.fn(),
}));

vi.mock('../resolveBacklogProject', () => ({
  resolveBacklogProject: hoisted.resolveBacklogProject,
  resolveEntryProjectId: hoisted.resolveEntryProjectId,
}));

const project = { id: 'p-1', workspaceId: 'w-1', name: 'FreStyle', createdAt: '', updatedAt: '' };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useBacklogProject', () => {
  it('見つからないことと、読み込めなかったことを分けて返す', async () => {
    hoisted.resolveBacklogProject.mockResolvedValue(null);
    const { result } = renderHook(() => useBacklogProject('p-9', () => {}));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('読み込めなかったら、取り直して続きを出せる', async () => {
    hoisted.resolveBacklogProject.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useBacklogProject('p-1', () => {}));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.notFound).toBe(false);

    hoisted.resolveBacklogProject.mockResolvedValueOnce({ workspaceSlug: 'acme', project });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.project?.id).toBe('p-1'));
    expect(result.current.error).toBeNull();
    expect(hoisted.resolveBacklogProject).toHaveBeenCalledTimes(2);
  });

  it('入口（projectId 無し）で読み込めなかったときも取り直せる', async () => {
    hoisted.resolveEntryProjectId.mockRejectedValueOnce(new Error('network'));
    const onResolved = vi.fn();
    const { result } = renderHook(() => useBacklogProject(undefined, onResolved));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    hoisted.resolveEntryProjectId.mockResolvedValueOnce('p-1');
    act(() => result.current.retry());

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('p-1'));
  });
});
