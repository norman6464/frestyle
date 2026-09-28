import type { UseQueryResult } from '@tanstack/react-query';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect } from 'vitest';
import { queryShownState } from '../queryState';

function result(over: Partial<UseQueryResult<string[], unknown>>): UseQueryResult<string[], unknown> {
  return { data: undefined, error: null, isPending: false, isError: false, isFetching: false, ...over } as UseQueryResult<
    string[],
    unknown
  >;
}

function httpError(status: number): AxiosError {
  return new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

describe('queryShownState', () => {
  it('まだ結果が無く取りに行っている間は読み込み中', () => {
    expect(queryShownState(result({ isPending: true, isFetching: true }))).toMatchObject({
      data: undefined,
      loading: true,
      failed: false,
    });
  });

  it('結果が無いまま失敗したら失敗', () => {
    expect(queryShownState(result({ isError: true, error: new Error('network') }))).toMatchObject({
      loading: false,
      failed: true,
      lostAccess: false,
    });
  });

  it('失敗のあと取り直している間は読み込み中に戻す', () => {
    expect(queryShownState(result({ isError: true, isFetching: true }))).toMatchObject({ loading: true, failed: false });
  });

  it('結果を持っていれば、取り直しの間も一時的な失敗でも出し続ける', () => {
    expect(queryShownState(result({ data: ['a'], isFetching: true }))).toMatchObject({
      data: ['a'],
      loading: false,
      failed: false,
    });
    expect(queryShownState(result({ data: ['a'], isError: true, error: new Error('network') }))).toMatchObject({
      data: ['a'],
      loading: false,
      failed: false,
    });
  });

  it.each([403, 404])('取り直しが %d（見る立場を失った）なら、持っている結果も出さずに失敗にする', (status) => {
    expect(queryShownState(result({ data: ['a'], isError: true, error: httpError(status) }))).toEqual({
      data: undefined,
      loading: false,
      failed: true,
      lostAccess: true,
    });
  });

  it('宛先がそろっていなければ何も出さない', () => {
    expect(queryShownState(result({ data: ['a'], isPending: true }), false)).toEqual({
      data: undefined,
      loading: false,
      failed: false,
      lostAccess: false,
    });
  });
});
