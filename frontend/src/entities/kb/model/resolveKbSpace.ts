import {
  firstAcrossLists,
  locateInList,
  type LocatedListState,
  type LocationState,
  type OwnedListState,
} from '@/shared/lib/acrossLists';
import type { Workspace } from '@/entities/workspace/@x/kb';
import type { KbMySpace } from './types';

/** 1 つのワークスペースの「自分が役割を持つスペースの一覧」の、今の取り具合。 */
export interface MySpacesState {
  workspaceSlug: string;
  data: KbMySpace[] | undefined;
  isError: boolean;
  isFetching: boolean;
}

/**
 * 解決の結果。一覧がそろうまでは決めない（loading）。一覧が 1 つでも読めず、それが無いと
 * 決まらないなら error。
 */
export type KbSpaceResolution<T> =
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'found'; value: T }
  | { kind: 'none' };

export interface ResolvedKbSpace {
  workspaceSlug: string;
  space: KbMySpace;
}

/**
 * 見る順に並べたワークスペース。`preferredWorkspaceSlug` を先頭へ出す（スペース切替の
 * 「すべてのスペース」が対象ワークスペースを持ち越すため）。所属に無い slug
 * （招待の取り消し等）は無視し、所属の順のまま返す。
 */
export function orderWorkspaces(workspaces: Workspace[], preferredWorkspaceSlug?: string): Workspace[] {
  if (!preferredWorkspaceSlug || !workspaces.some((w) => w.slug === preferredWorkspaceSlug)) return workspaces;
  return [
    ...workspaces.filter((w) => w.slug === preferredWorkspaceSlug),
    ...workspaces.filter((w) => w.slug !== preferredWorkspaceSlug),
  ];
}

/**
 * 素の /kb/spaces（スペース未指定）で最初に開くスペースを決める。見る順に並べたワークスペースの
 * うち、自分がアクセスできるスペースを持つ最初のもの → その最初のスペース（配列の順序=並び順）。
 *
 * 前のワークスペースの一覧がまだ無い・取り直し中なら決めない（後ろのワークスペースを先に
 * 選ぶと、並び順どおりにならない）。空の一覧を取り直している間も決めない（作ったばかりの
 * スペースが、取り直せば入ってくる）。
 */
export function pickEntryKbSpace(lists: MySpacesState[]): KbSpaceResolution<string> {
  const resolved = firstAcrossLists(lists.map(toOwned));
  return resolved.kind === 'found' ? { kind: 'found', value: resolved.item.id } : resolved;
}

/** 所在の口（/kb/spaces/:spaceId）の今の取り具合。owner はワークスペースの slug。 */
export type SpaceLocationState = LocationState;

/** 所在が教えたワークスペースの「自分が役割を持つスペースの一覧」の今の取り具合。 */
export type LocatedMySpacesState = LocatedListState<KbMySpace>;

/**
 * spaceId のスペースを決める。どのワークスペースかは所在の口で引き、スペースそのもの（名前・役割）は
 * そのワークスペースの一覧から読む（判断は shared/lib/acrossLists の locateInList）。
 */
export function locateKbSpace(
  spaceId: string,
  location: SpaceLocationState,
  list: LocatedMySpacesState,
): KbSpaceResolution<ResolvedKbSpace> {
  const resolved = locateInList(location, list, (space) => space.id === spaceId);
  return resolved.kind === 'found'
    ? { kind: 'found', value: { workspaceSlug: resolved.owner, space: resolved.item } }
    : resolved;
}

function toOwned(list: MySpacesState): OwnedListState<KbMySpace> {
  return { owner: list.workspaceSlug, data: list.data, isError: list.isError, isFetching: list.isFetching };
}
