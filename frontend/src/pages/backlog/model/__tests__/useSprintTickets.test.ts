import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSprintTickets } from '../useSprintTickets';

const hoisted = vi.hoisted(() => ({ fetchSprintTicketIds: vi.fn() }));

vi.mock('@/entities/sprint', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/sprint')>();
  return { ...actual, SprintRepository: { fetchSprintTicketIds: hoisted.fetchSprintTicketIds } };
});

/** あとから好きな時点で決着させられる約束。応答の返る順を入れ替えるために使う。 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

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

  /**
   * スプリントを切り替えた直後は、古い問い合わせがまだ飛んでいる。先に新しいほうが返り、
   * あとから古いほうが返ったとき、素直に setState すると**画面が前のスプリントの中身へ
   * 戻る**。世代の番号で古い応答を捨てる。
   */
  it('遅れて返った古い応答で新しい結果を上書きしない', async () => {
    const older = deferred<string[]>();
    const newer = deferred<string[]>();
    hoisted.fetchSprintTicketIds.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { result, rerender } = renderHook(({ ids }) => useSprintTickets('acme', ids), {
      initialProps: { ids: ['s-1'] },
    });
    rerender({ ids: ['s-2'] });

    await act(async () => {
      newer.resolve(['t-new']);
    });
    await waitFor(() => expect(result.current.bySprint).toEqual({ 's-2': ['t-new'] }));

    await act(async () => {
      older.resolve(['t-old']);
    });
    expect(result.current.bySprint).toEqual({ 's-2': ['t-new'] });
  });

  /** 失敗も同じ。古い問い合わせが後から転んでも、新しい結果と知らせを巻き戻さない。 */
  it('遅れて返った古い失敗で知らせを出さない', async () => {
    const older = deferred<string[]>();
    const newer = deferred<string[]>();
    hoisted.fetchSprintTicketIds.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

    const { result, rerender } = renderHook(({ ids }) => useSprintTickets('acme', ids), {
      initialProps: { ids: ['s-1'] },
    });
    rerender({ ids: ['s-2'] });

    await act(async () => {
      newer.resolve(['t-new']);
    });
    await waitFor(() => expect(result.current.error).toBeNull());

    await act(async () => {
      older.reject(new Error('boom'));
    });
    expect(result.current.error).toBeNull();
    expect(result.current.bySprint).toEqual({ 's-2': ['t-new'] });
  });
});
