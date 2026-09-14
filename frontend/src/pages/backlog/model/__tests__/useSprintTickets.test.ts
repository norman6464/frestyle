import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSprintTickets } from '../useSprintTickets';

const hoisted = vi.hoisted(() => ({ fetchSprintTicketIds: vi.fn() }));

vi.mock('@/entities/sprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/sprint')>();
  return { ...actual, SprintRepository: { fetchSprintTicketIds: hoisted.fetchSprintTicketIds } };
});

describe('useSprintTickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('スプリントごとにチケット ID を持つ', async () => {
    hoisted.fetchSprintTicketIds.mockImplementation(async (_slug: string, id: string) =>
      id === 's-1' ? ['t-1', 't-2'] : ['t-3'],
    );

    const { result } = renderHook(() => useSprintTickets('acme', ['s-1', 's-2']));

    await waitFor(() => expect(Object.keys(result.current.bySprint)).toHaveLength(2));
    expect(result.current.bySprint['s-1']).toEqual(['t-1', 't-2']);
    expect(result.current.error).toBeNull();
  });

  /**
   * 読めなかったことを黙って飲み込むと、**スプリントの中身が空になり、そのチケットが
   * バックログ側に並ぶ**。間違った場所に居るのに間違っていると分からない見え方になるので、
   * 必ず知らせる。
   */
  it('取れなければ知らせる（空として黙って出さない）', async () => {
    hoisted.fetchSprintTicketIds.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useSprintTickets('acme', ['s-1']));

    await waitFor(() => expect(result.current.error).toBe('スプリントの中身を読み込めませんでした。'));
    expect(result.current.bySprint).toEqual({});
  });

  it('ワークスペースやスプリントが決まっていなければ問い合わせない', async () => {
    const { result } = renderHook(() => useSprintTickets(undefined, ['s-1']));

    await waitFor(() => expect(result.current.bySprint).toEqual({}));
    expect(hoisted.fetchSprintTicketIds).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
