import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useTicketLabels } from '../useTicketLabels';
import type { Label } from '@/entities/ticket';

const hoisted = vi.hoisted(() => ({
  fetchLabels: vi.fn(),
  createLabel: vi.fn(),
  updateLabel: vi.fn(),
  deleteLabel: vi.fn(),
}));

vi.mock('@/entities/ticket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/ticket')>();
  return {
    ...actual,
    TicketRepository: {
      fetchLabels: hoisted.fetchLabels,
      createLabel: hoisted.createLabel,
      updateLabel: hoisted.updateLabel,
      deleteLabel: hoisted.deleteLabel,
    },
  };
});

function fixtureLabel(over: Partial<Label> & { id: string }): Label {
  return { projectId: 's-1', name: 'ラベル', color: '#1d4ed8', createdAt: '', updatedAt: '', ...over };
}

const SLUG = 'acme';
const SPACE = 's-1';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useTicketLabels', () => {
  it('宛先が揃ったら取得する', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1' })]);
    const { result } = renderHook(() => useTicketLabels(SLUG, SPACE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.labels).toHaveLength(1);
    expect(hoisted.fetchLabels).toHaveBeenCalledWith(SLUG);
  });

  it('取得失敗は文言を出す', async () => {
    hoisted.fetchLabels.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketLabels(SLUG, SPACE));
    await waitFor(() => expect(result.current.error).not.toBeNull());
  });

  it('作成すると末尾に足す（一覧を取り直さない）', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1' })]);
    const created = fixtureLabel({ id: 'l-2', name: '検索' });
    hoisted.createLabel.mockResolvedValue(created);

    const { result } = renderHook(() => useTicketLabels(SLUG, SPACE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createLabel({ name: '検索', color: '#1d4ed8' });
    });

    expect(result.current.labels.map((l) => l.id)).toEqual(['l-1', 'l-2']);
    expect(hoisted.fetchLabels).toHaveBeenCalledTimes(1);
  });

  it('更新すると該当行だけ差し替える', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1', name: '旧名' })]);
    hoisted.updateLabel.mockResolvedValue(fixtureLabel({ id: 'l-1', name: '新名' }));

    const { result } = renderHook(() => useTicketLabels(SLUG, SPACE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.updateLabel('l-1', { name: '新名', color: '#1d4ed8' });
    });

    expect(result.current.labels[0].name).toBe('新名');
  });

  it('削除すると一覧から外す', async () => {
    hoisted.fetchLabels.mockResolvedValue([fixtureLabel({ id: 'l-1' })]);
    hoisted.deleteLabel.mockResolvedValue(undefined);

    const { result } = renderHook(() => useTicketLabels(SLUG, SPACE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.deleteLabel('l-1');
    });

    expect(result.current.labels).toEqual([]);
  });

  it('宛先が揃っていなければ何もしない', () => {
    const { result } = renderHook(() => useTicketLabels(undefined, undefined));
    expect(result.current.labels).toEqual([]);
    expect(hoisted.fetchLabels).not.toHaveBeenCalled();
  });
});
