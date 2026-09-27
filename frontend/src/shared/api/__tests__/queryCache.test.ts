import { QueryObserver, queryOptions } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { createTestQueryClient } from '@/test/queryClient';
import { reflectWrite } from '../queryCache';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function listQuery(fetch: () => Promise<string[]>) {
  return queryOptions({ queryKey: ['items'] as const, queryFn: fetch });
}

describe('reflectWrite', () => {
  it('一覧を持っていれば、応答で差し替える（取り直さない）', async () => {
    const client = createTestQueryClient();
    const fetch = vi.fn(async () => ['a']);
    await client.fetchQuery(listQuery(fetch));

    await reflectWrite(client, listQuery(fetch).queryKey, (prev) => [...prev, 'b']);

    expect(client.getQueryData(listQuery(fetch).queryKey)).toEqual(['a', 'b']);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('書き込み前に飛んでいた取得の古い結果で、あとから上書きしない', async () => {
    const client = createTestQueryClient();
    const stale = deferred<string[]>();
    const fetch = vi.fn().mockResolvedValueOnce(['a']).mockImplementationOnce(() => stale.promise);
    const query = listQuery(fetch);
    await client.fetchQuery(query);
    const observer = new QueryObserver(client, query);
    const unsubscribe = observer.subscribe(() => {});
    void client.refetchQueries({ queryKey: query.queryKey });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    await reflectWrite(client, query.queryKey, (prev) => [...prev, 'b']);
    stale.resolve(['a']);
    await stale.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(client.getQueryData(query.queryKey)).toEqual(['a', 'b']);
    unsubscribe();
  });

  it('まだ一覧が無ければ（最初の読み込み中に書いた）、足しかけの一覧を作らずに取り直させる', async () => {
    const client = createTestQueryClient();
    const first = deferred<string[]>();
    const fetch = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValueOnce(['a', 'b']);
    const query = listQuery(fetch);
    const observer = new QueryObserver(client, query);
    const unsubscribe = observer.subscribe(() => {});
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    await reflectWrite(client, query.queryKey, (prev) => [...prev, 'b']);
    first.resolve(['a']);

    await vi.waitFor(() => expect(client.getQueryData(query.queryKey)).toEqual(['a', 'b']));
    expect(fetch).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
