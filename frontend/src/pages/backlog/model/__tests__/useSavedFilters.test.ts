import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TicketSavedFilter } from '@/entities/ticket';
import { useSavedFilters } from '../useSavedFilters';

const hoisted = vi.hoisted(() => ({
  fetchSavedFilters: vi.fn(),
  createSavedFilter: vi.fn(),
  updateSavedFilter: vi.fn(),
  deleteSavedFilter: vi.fn(),
}));

vi.mock('@/entities/ticket', () => ({
  TicketRepository: {
    fetchSavedFilters: hoisted.fetchSavedFilters,
    createSavedFilter: hoisted.createSavedFilter,
    updateSavedFilter: hoisted.updateSavedFilter,
    deleteSavedFilter: hoisted.deleteSavedFilter,
  },
}));

const SLUG = 'acme';
const PROJECT = 'p-1';

const filter = (over: Partial<TicketSavedFilter> & { id: string }): TicketSavedFilter => ({
  name: '絞り込み',
  statusId: null,
  typeId: null,
  labelId: null,
  assigneePrincipalId: null,
  unassigned: false,
  assignedToMe: false,
  overdue: true,
  q: null,
  count: 1,
  createdAt: '2026-09-24T00:00:00Z',
  updatedAt: '2026-09-24T00:00:00Z',
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useSavedFilters', () => {
  it('宛先が揃っていなければ取りに行かない', () => {
    const { result } = renderHook(() => useSavedFilters(undefined, PROJECT));
    expect(result.current.filters).toEqual([]);
    expect(hoisted.fetchSavedFilters).not.toHaveBeenCalled();
  });

  it('揃うと取得し、作った順のまま返す', async () => {
    hoisted.fetchSavedFilters.mockResolvedValue([filter({ id: 'f-1' }), filter({ id: 'f-2' })]);
    const { result } = renderHook(() => useSavedFilters(SLUG, PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.fetchSavedFilters).toHaveBeenCalledWith(SLUG, PROJECT);
    expect(result.current.filters.map((f) => f.id)).toEqual(['f-1', 'f-2']);
    expect(result.current.error).toBeNull();
  });

  it('最初の取得に失敗したら error を出す（0 件と取り違えない）', async () => {
    hoisted.fetchSavedFilters.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useSavedFilters(SLUG, PROJECT));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.filters).toEqual([]);
    expect(result.current.countsFailed).toBe(false);
  });

  it('取り直しに失敗しても名前は残し、countsFailed を立てる。次に成功したら下ろす', async () => {
    hoisted.fetchSavedFilters.mockResolvedValueOnce([filter({ id: 'f-1', count: 3 })]);
    const { result } = renderHook(() => useSavedFilters(SLUG, PROJECT));
    await waitFor(() => expect(result.current.filters).toHaveLength(1));

    hoisted.fetchSavedFilters.mockRejectedValueOnce(new Error('boom'));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.countsFailed).toBe(true));
    expect(result.current.filters[0].count).toBe(3);
    expect(result.current.error).toBeNull();

    hoisted.fetchSavedFilters.mockResolvedValueOnce([filter({ id: 'f-1', count: 2 })]);
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.filters[0].count).toBe(2));
    expect(result.current.countsFailed).toBe(false);
  });

  it('保存すると末尾に足す（一覧を取り直さない）', async () => {
    hoisted.fetchSavedFilters.mockResolvedValue([filter({ id: 'f-1' })]);
    const created = filter({ id: 'f-2', name: '新しい', count: 0 });
    hoisted.createSavedFilter.mockResolvedValue(created);
    const { result } = renderHook(() => useSavedFilters(SLUG, PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.create({ name: '新しい', overdue: true });
    });
    expect(hoisted.createSavedFilter).toHaveBeenCalledWith(SLUG, PROJECT, { name: '新しい', overdue: true });
    expect(result.current.filters.map((f) => f.id)).toEqual(['f-1', 'f-2']);
    expect(hoisted.fetchSavedFilters).toHaveBeenCalledTimes(1);
  });

  it('改名は条件を手元の値のまま送り、該当行だけ差し替える', async () => {
    const before = filter({ id: 'f-1', name: '旧名', labelId: 'l-1', assignedToMe: true, q: '検索' });
    hoisted.fetchSavedFilters.mockResolvedValue([before]);
    hoisted.updateSavedFilter.mockResolvedValue({ ...before, name: '新名' });
    const { result } = renderHook(() => useSavedFilters(SLUG, PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.rename(before, '新名');
    });
    expect(hoisted.updateSavedFilter).toHaveBeenCalledWith(SLUG, PROJECT, 'f-1', {
      name: '新名',
      statusId: null,
      typeId: null,
      labelId: 'l-1',
      assigneePrincipalId: null,
      unassigned: false,
      assignedToMe: true,
      overdue: true,
      q: '検索',
    });
    expect(result.current.filters[0].name).toBe('新名');
  });

  it('削除すると一覧から外す', async () => {
    hoisted.fetchSavedFilters.mockResolvedValue([filter({ id: 'f-1' }), filter({ id: 'f-2' })]);
    hoisted.deleteSavedFilter.mockResolvedValue(undefined);
    const { result } = renderHook(() => useSavedFilters(SLUG, PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove('f-1');
    });
    expect(hoisted.deleteSavedFilter).toHaveBeenCalledWith(SLUG, PROJECT, 'f-1');
    expect(result.current.filters.map((f) => f.id)).toEqual(['f-2']);
  });

  it('失敗は投げ返し、一覧は変えない', async () => {
    hoisted.fetchSavedFilters.mockResolvedValue([filter({ id: 'f-1' })]);
    hoisted.createSavedFilter.mockRejectedValue(new Error('409'));
    const { result } = renderHook(() => useSavedFilters(SLUG, PROJECT));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(result.current.create({ name: '重複', overdue: true })).rejects.toThrow();
    expect(result.current.filters).toHaveLength(1);
  });

  it('プロジェクトを切り替えると取り直し、前の応答は無視する', async () => {
    let resolveFirst: (v: TicketSavedFilter[]) => void = () => {};
    hoisted.fetchSavedFilters.mockReturnValueOnce(
      new Promise<TicketSavedFilter[]>((resolve) => {
        resolveFirst = resolve;
      }),
    );
    hoisted.fetchSavedFilters.mockResolvedValueOnce([filter({ id: 'f-9' })]);

    const { result, rerender } = renderHook(({ projectId }) => useSavedFilters(SLUG, projectId), {
      initialProps: { projectId: 'p-1' },
    });
    rerender({ projectId: 'p-2' });
    await waitFor(() => expect(result.current.filters.map((f) => f.id)).toEqual(['f-9']));

    resolveFirst([filter({ id: 'f-1' })]);
    await Promise.resolve();
    expect(result.current.filters.map((f) => f.id)).toEqual(['f-9']);
  });
});
