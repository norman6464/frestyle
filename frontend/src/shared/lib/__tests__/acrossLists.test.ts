import { describe, it, expect } from 'vitest';
import { locateInList, type LocatedListState, type LocationState } from '../acrossLists';

interface Item {
  id: string;
}

const located = (owner: string): LocationState => ({ owner, lostAccess: false, failed: false });
const list = (over: Partial<LocatedListState<Item>> = {}): LocatedListState<Item> => ({
  data: [{ id: 'x-1' }],
  lostAccess: false,
  failed: false,
  isFetching: false,
  ...over,
});
const byId = (id: string) => (item: Item) => item.id === id;

describe('locateInList', () => {
  it('所在が教えた入れ物の一覧から探す', () => {
    expect(locateInList(located('a'), list(), byId('x-1'))).toEqual({ kind: 'found', owner: 'a', item: { id: 'x-1' } });
  });

  it('所在がまだ分からなければ決めない', () => {
    expect(locateInList({ owner: undefined, lostAccess: false, failed: false }, list(), byId('x-1'))).toEqual({
      kind: 'loading',
    });
  });

  it('所在が 404・403（無い・見る立場に無い）なら見つからない', () => {
    expect(locateInList({ owner: undefined, lostAccess: true, failed: false }, list(), byId('x-1'))).toEqual({
      kind: 'none',
    });
  });

  it('所在を読み込めなければ失敗（見つからないとは言わない）', () => {
    expect(locateInList({ owner: undefined, lostAccess: false, failed: true }, list(), byId('x-1'))).toEqual({
      kind: 'error',
    });
  });

  it('一覧がまだ無ければ決めない', () => {
    expect(locateInList(located('a'), list({ data: undefined, isFetching: true }), byId('x-1'))).toEqual({
      kind: 'loading',
    });
  });

  it('一覧を取り直している間は、見つからないとは言わない（作ったばかりのものへ移った直後）', () => {
    expect(locateInList(located('a'), list({ isFetching: true }), byId('x-new'))).toEqual({ kind: 'loading' });
  });

  it('一覧にあれば、取り直し中でも決める', () => {
    expect(locateInList(located('a'), list({ isFetching: true }), byId('x-1'))).toEqual({
      kind: 'found',
      owner: 'a',
      item: { id: 'x-1' },
    });
  });

  it('一覧を読み込めなければ失敗', () => {
    expect(locateInList(located('a'), list({ data: undefined, failed: true }), byId('x-1'))).toEqual({ kind: 'error' });
  });

  it('一覧を見る立場を失った（入れ物から外された・消された）なら見つからない', () => {
    expect(locateInList(located('a'), list({ data: undefined, lostAccess: true }), byId('x-1'))).toEqual({
      kind: 'none',
    });
  });

  it('一覧がそろって見つからなければ見つからない', () => {
    expect(locateInList(located('a'), list(), byId('x-gone'))).toEqual({ kind: 'none' });
  });
});
