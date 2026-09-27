import type { UseQueryResult } from '@tanstack/react-query';
import { describe, it, expect } from 'vitest';
import { queryShownState } from '../queryState';

function result(over: Partial<UseQueryResult<string[], unknown>>): UseQueryResult<string[], unknown> {
  return { data: undefined, isPending: false, isError: false, isFetching: false, ...over } as UseQueryResult<
    string[],
    unknown
  >;
}

describe('queryShownState', () => {
  it('まだ結果が無く取りに行っている間は読み込み中', () => {
    expect(queryShownState(result({ isPending: true, isFetching: true }))).toEqual({ loading: true, failed: false });
  });

  it('結果が無いまま失敗したら失敗', () => {
    expect(queryShownState(result({ isError: true }))).toEqual({ loading: false, failed: true });
  });

  it('失敗のあと取り直している間は読み込み中に戻す', () => {
    expect(queryShownState(result({ isError: true, isFetching: true }))).toEqual({ loading: true, failed: false });
  });

  it('結果を持っていれば、取り直しの間も取り直しに失敗しても出さない', () => {
    expect(queryShownState(result({ data: ['a'], isFetching: true }))).toEqual({ loading: false, failed: false });
    expect(queryShownState(result({ data: ['a'], isError: true }))).toEqual({ loading: false, failed: false });
  });

  it('宛先がそろっていなければどちらも出さない', () => {
    expect(queryShownState(result({ isPending: true }), false)).toEqual({ loading: false, failed: false });
    expect(queryShownState(result({ isError: true }), false)).toEqual({ loading: false, failed: false });
  });
});
