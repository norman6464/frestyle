import { describe, it, expect } from 'vitest';
import {
  locateKbSpace,
  orderWorkspaces,
  pickEntryKbSpace,
  type LocatedMySpacesState,
  type MySpacesState,
  type SpaceLocationState,
} from '../resolveKbSpace';

const WS_A = { slug: 'a', name: 'A', createdAt: '', canManage: true };
const WS_B = { slug: 'b', name: 'B', createdAt: '', canManage: false };
const SPACE_A1 = { id: 'sp-a1', name: 'A のスペース', role: 'admin' as const };
const SPACE_B1 = { id: 'sp-b1', name: 'B のスペース', role: 'viewer' as const };

function loaded(workspaceSlug: string, data: MySpacesState['data'], isFetching = false): MySpacesState {
  return { workspaceSlug, data, isError: false, isFetching };
}
const pending = (workspaceSlug: string): MySpacesState => ({
  workspaceSlug,
  data: undefined,
  isError: false,
  isFetching: true,
});
const failed = (workspaceSlug: string): MySpacesState => ({
  workspaceSlug,
  data: undefined,
  isError: true,
  isFetching: false,
});

describe('orderWorkspaces', () => {
  it('preferredWorkspaceSlug 無しでは、所属の順のまま', () => {
    expect(orderWorkspaces([WS_A, WS_B])).toEqual([WS_A, WS_B]);
  });

  it('preferredWorkspaceSlug があれば、そのワークスペースを先頭へ出す', () => {
    expect(orderWorkspaces([WS_A, WS_B], 'b')).toEqual([WS_B, WS_A]);
  });

  it('preferred が所属に無い slug なら無視する', () => {
    expect(orderWorkspaces([WS_A, WS_B], 'gone')).toEqual([WS_A, WS_B]);
  });
});

describe('pickEntryKbSpace', () => {
  it('並びの先頭から、スペースを持つ最初のワークスペースの最初のスペース', () => {
    expect(pickEntryKbSpace([loaded('a', [SPACE_A1]), loaded('b', [SPACE_B1])])).toEqual({
      kind: 'found',
      value: 'sp-a1',
    });
  });

  it('前のワークスペースにスペースが無ければ、次のワークスペースへ進む', () => {
    expect(pickEntryKbSpace([loaded('a', []), loaded('b', [SPACE_B1])])).toEqual({ kind: 'found', value: 'sp-b1' });
  });

  it('前のワークスペースの一覧がまだ無ければ、後ろが先にそろっても決めない', () => {
    expect(pickEntryKbSpace([pending('a'), loaded('b', [SPACE_B1])])).toEqual({ kind: 'loading' });
  });

  it('空の一覧を取り直している間は決めない（作ったばかりのスペースが入ってくる）', () => {
    expect(pickEntryKbSpace([loaded('a', [], true), loaded('b', [SPACE_B1])])).toEqual({ kind: 'loading' });
  });

  it('前のワークスペースの一覧が読めなければ失敗', () => {
    expect(pickEntryKbSpace([failed('a'), loaded('b', [SPACE_B1])])).toEqual({ kind: 'error' });
  });

  it('どのワークスペースにもスペースが無ければ none', () => {
    expect(pickEntryKbSpace([loaded('a', [])])).toEqual({ kind: 'none' });
    expect(pickEntryKbSpace([])).toEqual({ kind: 'none' });
  });
});

describe('locateKbSpace', () => {
  const located = (workspaceSlug: string): SpaceLocationState => ({ workspaceSlug, lostAccess: false, failed: false });
  const list = (over: Partial<LocatedMySpacesState> = {}): LocatedMySpacesState => ({
    data: [SPACE_B1],
    lostAccess: false,
    failed: false,
    isFetching: false,
    ...over,
  });

  it('所在の口が教えたワークスペースの一覧から、スペースを読む', () => {
    expect(locateKbSpace('sp-b1', located('b'), list())).toEqual({
      kind: 'found',
      value: { workspaceSlug: 'b', space: SPACE_B1 },
    });
  });

  it('所在がまだ分からなければ決めない', () => {
    expect(locateKbSpace('sp-b1', { workspaceSlug: undefined, lostAccess: false, failed: false }, list())).toEqual({
      kind: 'loading',
    });
  });

  it('所在が 404・403（無い・見る立場に無い）なら見つからない', () => {
    expect(locateKbSpace('sp-x', { workspaceSlug: undefined, lostAccess: true, failed: false }, list())).toEqual({
      kind: 'none',
    });
  });

  it('所在を読み込めなければ失敗（見つからないとは言わない）', () => {
    expect(locateKbSpace('sp-b1', { workspaceSlug: undefined, lostAccess: false, failed: true }, list())).toEqual({
      kind: 'error',
    });
  });

  it('一覧がまだ無ければ決めない', () => {
    expect(locateKbSpace('sp-b1', located('b'), list({ data: undefined, isFetching: true }))).toEqual({ kind: 'loading' });
  });

  it('一覧を取り直している間は、見つからないとは言わない（作ったばかりのスペースへ移った直後）', () => {
    expect(locateKbSpace('sp-new', located('b'), list({ isFetching: true }))).toEqual({ kind: 'loading' });
  });

  it('一覧にあれば、取り直し中でも決める', () => {
    expect(locateKbSpace('sp-b1', located('b'), list({ isFetching: true }))).toEqual({
      kind: 'found',
      value: { workspaceSlug: 'b', space: SPACE_B1 },
    });
  });

  it('一覧を読み込めなければ失敗', () => {
    expect(locateKbSpace('sp-b1', located('b'), list({ data: undefined, failed: true }))).toEqual({ kind: 'error' });
  });

  it('一覧を見る立場を失った（ワークスペースを外された・消された）なら見つからない', () => {
    expect(locateKbSpace('sp-b1', located('b'), list({ data: undefined, lostAccess: true }))).toEqual({ kind: 'none' });
  });

  it('一覧がそろって見つからなければ見つからない（スペースの役割を外された・消された）', () => {
    expect(locateKbSpace('sp-gone', located('b'), list())).toEqual({ kind: 'none' });
  });
});
