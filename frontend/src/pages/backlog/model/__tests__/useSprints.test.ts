import { renderHook as rtlRenderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSprints } from '../useSprints';
import type { Sprint } from '@/entities/sprint';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { sprintKeys } from '@/entities/sprint/api/sprintQueries';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const hoisted = vi.hoisted(() => ({ fetchSprints: vi.fn(), createSprint: vi.fn(), addTicketToSprint: vi.fn() }));

// 取得の本体を偽物にする（公開口の SprintRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/sprint/api/sprintRepository', () => ({
  SprintRepository: {
    fetchSprints: hoisted.fetchSprints,
    createSprint: hoisted.createSprint,
    addTicketToSprint: hoisted.addTicketToSprint,
  },
}));

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

  it('前のプロジェクトで始めた操作が切り替えたあとに終わっても、今のプロジェクトの取得を横取りしない', async () => {
    let finishCreate: () => void = () => {};
    hoisted.createSprint.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishCreate = resolve;
        }),
    );
    let resolveB: (value: Sprint[]) => void = () => {};
    hoisted.fetchSprints.mockImplementation((_slug: string, projectId: string) =>
      projectId === 'p-1'
        ? Promise.resolve([sprint('s-1', 'A のスプリント')])
        : new Promise<Sprint[]>((resolve) => {
            resolveB = resolve;
          }),
    );
    const { result, rerender } = renderHook(({ projectId }) => useSprints('acme', projectId), {
      initialProps: { projectId: 'p-1' },
    });
    await waitFor(() => expect(result.current.sprints.map((s) => s.id)).toEqual(['s-1']));

    // A でスプリントを作っている途中に B へ移る。B の取得がまだ返らないうちに A の作成が終わる。
    let creating: Promise<void> = Promise.resolve();
    act(() => {
      creating = result.current.create({ name: '次' });
    });
    rerender({ projectId: 'p-2' });
    await act(async () => {
      finishCreate();
      await creating;
    });
    await act(async () => {
      resolveB([sprint('s-2', 'B のスプリント')]);
    });

    await waitFor(() => expect(result.current.sprints.map((s) => s.id)).toEqual(['s-2']));
    expect(result.current.loading).toBe(false);
  });

  it('切り替え先の取得に失敗したとき、前のプロジェクトの一覧を出したままにしない', async () => {
    hoisted.fetchSprints.mockImplementation((_slug: string, projectId: string) =>
      projectId === 'p-1' ? Promise.resolve([sprint('s-1', 'A のスプリント')]) : Promise.reject(new Error('network')),
    );
    const { result, rerender } = renderHook(({ projectId }) => useSprints('acme', projectId), {
      initialProps: { projectId: 'p-1' },
    });
    await waitFor(() => expect(result.current.sprints.map((s) => s.id)).toEqual(['s-1']));

    rerender({ projectId: 'p-2' });

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.sprints).toEqual([]);
  });

  it('切り替えた直後の描画から、前のプロジェクトの一覧を出さずに読み込み中にする', async () => {
    hoisted.fetchSprints.mockImplementation((_slug: string, projectId: string) =>
      projectId === 'p-1' ? Promise.resolve([sprint('s-1', 'A のスプリント')]) : new Promise<Sprint[]>(() => {}),
    );
    const seen: { ids: string[]; loading: boolean }[] = [];
    const { result, rerender } = renderHook(
      ({ projectId }) => {
        const state = useSprints('acme', projectId);
        seen.push({ ids: state.sprints.map((s) => s.id), loading: state.loading });
        return state;
      },
      { initialProps: { projectId: 'p-1' } },
    );
    await waitFor(() => expect(result.current.sprints.map((s) => s.id)).toEqual(['s-1']));
    seen.length = 0;

    rerender({ projectId: 'p-2' });

    expect(seen[0]).toEqual({ ids: [], loading: true });
    expect(seen.every((s) => s.ids.length === 0)).toBe(true);
  });

  it('宛先が外れたら、読み込み中と失敗の表示も片付ける', async () => {
    hoisted.fetchSprints.mockRejectedValue(new Error('network'));
    const { result, rerender } = renderHook(({ projectId }) => useSprints('acme', projectId), {
      initialProps: { projectId: 'p-1' as string | undefined },
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());

    rerender({ projectId: undefined });

    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.sprints).toEqual([]);
  });

  it('チケットを入れたら、一覧を取り直し、スプリントの中身とチケットの入っているスプリントも古くする', async () => {
    hoisted.fetchSprints.mockResolvedValue([sprint('s-1', 'A')]);
    hoisted.addTicketToSprint.mockResolvedValue(undefined);
    const client = createTestQueryClient();
    client.setQueryData(sprintKeys.ticketIds('acme', 's-1'), []);
    client.setQueryData(sprintKeys.ticketSprint('acme', 't-1'), null);
    const { result } = renderHook(() => useSprints('acme', 'p-1'), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.sprints).toHaveLength(1));

    await act(async () => {
      await result.current.addTicket('s-1', 't-1');
    });

    expect(hoisted.fetchSprints).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(sprintKeys.ticketIds('acme', 's-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(sprintKeys.ticketSprint('acme', 't-1'))?.isInvalidated).toBe(true);
  });
});
