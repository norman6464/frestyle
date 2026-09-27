import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useTicketLabels } from '../useTicketLabels';
import type { Label } from '@/entities/ticket';

const hoisted = vi.hoisted(() => ({
  fetchLabels: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の TicketRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/ticket/api/ticketRepository', () => ({
  default: {
    fetchLabels: hoisted.fetchLabels,
    createLabel: hoisted.createLabel,
    updateLabel: hoisted.updateLabel,
    deleteLabel: hoisted.deleteLabel,
  },
}));

function fixtureLabel(over: Partial<Label> & { id: string }): Label {
  return { projectId: 's-1', name: 'ラベル', color: '#1d4ed8', createdAt: '', updatedAt: '', ...over };
}

const SLUG = 'acme';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTicketLabels', () => {
  it('宛先が揃ったら取得する', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1' })]);
    const { result } = renderHook(() => useTicketLabels(SLUG), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.labels).toHaveLength(1);
    expect(hoisted.fetchLabels).toHaveBeenCalledWith(SLUG);
  });

  it('取得失敗は文言を出す', async () => {
    hoisted.fetchLabels.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketLabels(SLUG), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it('作成すると末尾に足す（一覧を取り直さない）', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1' })]);
    const created = fixtureLabel({ id: 'l-2', name: '検索' });
    hoisted.createLabel.mockResolvedValue(created);

    const { result } = renderHook(() => useTicketLabels(SLUG), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createLabel({ name: '検索', color: '#1d4ed8' });
    });

    await waitFor(() => expect(result.current.labels.map((l) => l.id)).toEqual(['l-1', 'l-2']));
    expect(hoisted.fetchLabels).toHaveBeenCalledTimes(1);
  });

  it('更新すると該当行だけ差し替える', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1', name: '旧名' })]);
    hoisted.updateLabel.mockResolvedValue(fixtureLabel({ id: 'l-1', name: '新名' }));

    const { result } = renderHook(() => useTicketLabels(SLUG), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateLabel('l-1', { name: '新名', color: '#1d4ed8' });
    });

    await waitFor(() => expect(result.current.labels[0].name).toBe('新名'));
  });

  it('削除すると一覧から外す', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1' })]);
    hoisted.deleteLabel.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketLabels(SLUG), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteLabel('l-1');
    });

    await waitFor(() => expect(result.current.labels).toEqual([]));
  });

  it('宛先が揃っていなければ何もしない', () => {
    const { result } = renderHook(() => useTicketLabels(undefined), { wrapper: queryWrapper() });
    expect(result.current.labels).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(hoisted.fetchLabels).not.toHaveBeenCalled();
  });

  // バックログとチケットの画面は同じワークスペースのラベルを使う。1 回だけ取り、
  // 片方で作った・消したラベルはもう片方にも出る。
  it('同じワークスペースのラベルは 1 回だけ取り、ほかの場所で作ったラベルも出る', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1' })]);
    hoisted.createLabel.mockResolvedValue(fixtureLabel({ id: 'l-2', name: '検索' }));
    const client = createTestQueryClient();
    const { result } = renderHook(() => ({ here: useTicketLabels(SLUG), there: useTicketLabels(SLUG) }), {
      wrapper: queryWrapper(client),
    });
    await waitFor(() => expect(result.current.here.loading).toBe(false));

    await act(async () => {
      await result.current.there.createLabel({ name: '検索', color: '#1d4ed8' });
    });

    await waitFor(() => expect(result.current.here.labels.map((l) => l.id)).toEqual(['l-1', 'l-2']));
    expect(hoisted.fetchLabels).toHaveBeenCalledTimes(1);
  });

  it('一覧を持っているうちの取り直しに失敗しても、一覧を出し続ける', async () => {
    hoisted.fetchLabels.mockResolvedValueOnce([fixtureLabel({ id: 'l-1' })]);
    const { result } = renderHook(() => useTicketLabels(SLUG), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.fetchLabels.mockRejectedValueOnce(new Error('network'));
    act(() => result.current.refresh());
    await waitFor(() => expect(hoisted.fetchLabels).toHaveBeenCalledTimes(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.labels).toHaveLength(1);
    expect(result.current.error).toBeNull();
    expect(result.current.loading).toBe(false);
  });
});
