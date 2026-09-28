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

// 状態の決め方（所在・一覧のどの状態で何と言うか）は shared/lib/acrossLists の locateInList が持ち、
// そちらのテストが表を確かめる。ここはスペースの形へ写すことだけを見る。
describe('locateKbSpace', () => {
  const located = (workspaceSlug: string): SpaceLocationState => ({ owner: workspaceSlug, lostAccess: false, failed: false });
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

  it('所在が 404・403 なら見つからない', () => {
    expect(locateKbSpace('sp-x', { owner: undefined, lostAccess: true, failed: false }, list())).toEqual({ kind: 'none' });
  });

  it('一覧を取り直している間は、見つからないとは言わない', () => {
    expect(locateKbSpace('sp-new', located('b'), list({ isFetching: true }))).toEqual({ kind: 'loading' });
  });
});
