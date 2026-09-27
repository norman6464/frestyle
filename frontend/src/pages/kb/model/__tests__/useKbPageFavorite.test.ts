import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useKbPageFavorite } from '../useKbPageFavorite';

const hoisted = vi.hoisted(() => ({ addFavorite: vi.fn(), removeFavorite: vi.fn() }));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: { addFavorite: hoisted.addFavorite, removeFavorite: hoisted.removeFavorite },
}));

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.addFavorite.mockResolvedValue(undefined);
  hoisted.removeFavorite.mockResolvedValue(undefined);
});

describe('useKbPageFavorite', () => {
  it('押したらその場で反転してから送り、お気に入りの一覧を古いものにする', async () => {
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.favorites('acme'), []);
    const { result } = renderHook(() => useKbPageFavorite('acme', 'p-1', false), { wrapper: queryWrapper(client) });

    let toggling: Promise<void> = Promise.resolve();
    act(() => {
      toggling = result.current.toggle();
    });
    expect(result.current.favorite).toBe(true);
    await act(async () => {
      await toggling;
    });

    expect(hoisted.addFavorite).toHaveBeenCalledWith('acme', 'p-1');
    expect(client.getQueryState(kbKeys.favorites('acme'))?.isInvalidated).toBe(true);
  });

  it('失敗したら元へ戻して投げ、一覧は古くしない', async () => {
    hoisted.removeFavorite.mockRejectedValue(new Error('boom'));
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.favorites('acme'), []);
    const { result } = renderHook(() => useKbPageFavorite('acme', 'p-1', true), { wrapper: queryWrapper(client) });

    await act(async () => {
      await expect(result.current.toggle()).rejects.toThrow('boom');
    });

    expect(result.current.favorite).toBe(true);
    expect(client.getQueryState(kbKeys.favorites('acme'))?.isInvalidated).toBe(false);
  });

  it('ページが変わったら、そのページの応答の値に戻す（描いている途中で合わせる）', async () => {
    const { result, rerender } = renderHook(
      ({ pageId, initial }: { pageId: string; initial: boolean }) => useKbPageFavorite('acme', pageId, initial),
      { wrapper: queryWrapper(), initialProps: { pageId: 'p-1', initial: false } },
    );
    await act(async () => {
      await result.current.toggle();
    });
    expect(result.current.favorite).toBe(true);

    rerender({ pageId: 'p-2', initial: false });

    expect(result.current.favorite).toBe(false);
    await waitFor(() => expect(result.current.pending).toBe(false));
  });
});
