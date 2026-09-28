import { firstAcrossLists, type OwnedListState } from '@/shared/lib/acrossLists';
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

/** 所在の口（/kb/spaces/:spaceId）の今の取り具合。 */
export interface SpaceLocationState {
  /** 分かったワークスペース。まだ分からなければ undefined。 */
  workspaceSlug: string | undefined;
  /** 無い・見る立場に無い（404・403）。 */
  lostAccess: boolean;
  /** 読み込めなかった（通信の失敗など）。取り直せば戻りうる。 */
  failed: boolean;
}

/** 所在が教えたワークスペースの「自分が役割を持つスペースの一覧」の今の取り具合。 */
export interface LocatedMySpacesState {
  data: KbMySpace[] | undefined;
  /** ワークスペースを見る立場を失った（外された・消された。404・403）。 */
  lostAccess: boolean;
  failed: boolean;
  isFetching: boolean;
}

/**
 * spaceId のスペースを決める。どのワークスペースかは所在の口で引き、スペースそのもの（名前・役割）は
 * そのワークスペースの一覧から読む（改名・役割の変更が一覧に届くので、別に控えない）。
 *
 * 見つからないと言えるのは、所在が 404・403 のとき、ワークスペースを見る立場を失ったとき、一覧が
 * そろって取り直し中でもないのに無いとき（役割を外された・消された）だけ。作ったばかりのスペースへ
 * 移った直後は、一覧を取り直している間は見つからないとは言わない。
 */
export function locateKbSpace(
  spaceId: string,
  location: SpaceLocationState,
  list: LocatedMySpacesState,
): KbSpaceResolution<ResolvedKbSpace> {
  if (location.lostAccess) return { kind: 'none' };
  if (location.failed) return { kind: 'error' };
  if (location.workspaceSlug === undefined) return { kind: 'loading' };
  if (list.lostAccess) return { kind: 'none' };
  const space = list.data?.find((s) => s.id === spaceId);
  if (space) return { kind: 'found', value: { workspaceSlug: location.workspaceSlug, space } };
  if (list.failed) return { kind: 'error' };
  if (list.data === undefined || list.isFetching) return { kind: 'loading' };
  return { kind: 'none' };
}

function toOwned(list: MySpacesState): OwnedListState<KbMySpace> {
  return { owner: list.workspaceSlug, data: list.data, isError: list.isError, isFetching: list.isFetching };
}
