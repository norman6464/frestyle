import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSprints } from '../useSprints';
import type { Sprint } from '@/entities/sprint';

const hoisted = vi.hoisted(() => ({ fetchSprints: vi.fn() }));

vi.mock('@/entities/sprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/sprint')>();
  return { ...actual, SprintRepository: { fetchSprints: hoisted.fetchSprints } };
});

function sprint(id: string, name: string): Sprint {
  return {
    id,
    workspaceId: 'w-1',
    projectId: 'p',
    name,
    state: 'planned',
    startDate: null,
    endDate: null,
    position: 'a0',
    ticketCount: 0,
    createdAt: '',
    updatedAt: '',
  } as Sprint;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSprints', () => {
  it('プロジェクトを切り替えたあとに届いた前のプロジェクトの一覧を、今の一覧に上書きしない', async () => {
    let resolveFirst: (value: Sprint[]) => void = () => {};
    hoisted.fetchSprints.mockImplementation((_slug: string, projectId: string) =>
      projectId === 'p-1'
        ? new Promise<Sprint[]>((resolve) => {
            resolveFirst = resolve;
          })
        : Promise.resolve([sprint('s-2', 'B のスプリント')]),
    );
    const { result, rerender } = renderHook(({ projectId }) => useSprints('acme', projectId), {
      initialProps: { projectId: 'p-1' },
    });

    rerender({ projectId: 'p-2' });
    await waitFor(() => expect(result.current.sprints.map((s) => s.id)).toEqual(['s-2']));

    await act(async () => {
      resolveFirst([sprint('s-1', 'A のスプリント')]);
    });

    expect(result.current.sprints.map((s) => s.id)).toEqual(['s-2']);
    expect(result.current.loading).toBe(false);
  });
});
