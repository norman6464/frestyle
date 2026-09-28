import { useCallback, useEffect, useEffectEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { workspacesQuery, type Workspace } from '@/entities/workspace/@x/kb';
import { kbKeys, kbMySpacesQuery, kbSpaceLocationQuery } from '../api/kbQueries';
import type { KbMySpace } from './types';
import {
  locateKbSpace,
  orderWorkspaces,
  pickEntryKbSpace,
  type KbSpaceResolution,
  type MySpacesState,
} from './resolveKbSpace';

export interface KbSpaceEntryState {
  workspaceSlug: string | null;
  space: KbMySpace | null;
  /** アクセスできるスペースが 1 つも無い（ワークスペースはあるがスペースが無い/役割が無い）。 */
  noSpaces: boolean;
  /** 指定のスペースが見つからない（消された・見る立場でない）。取り直しても変わらない。 */
  notFound: boolean;
  loading: boolean;
  /** 読み込めなかった（通信の失敗など）。取り直せば戻りうる。 */
  error: string | null;
}

const EMPTY: KbSpaceEntryState = {
  workspaceSlug: null,
  space: null,
  noSpaces: false,
  notFound: false,
  loading: false,
  error: null,
};

const NO_WORKSPACES: Workspace[] = [];
const LOAD_ERROR = 'スペースを読み込めませんでした。';

/**
 * useKbSpaceEntry は /kb/spaces（spaceId 無し）と /kb/spaces/:spaceId の両方を解決する
 * （段14。概要・すべてのページ・お気に入り・メンバーの 4 画面が共有する）。
 *
 * - spaceId あり: 所在の口（/kb/spaces/:spaceId）でどのワークスペースかを引き、スペースそのものは
 *   そのワークスペースの「自分が役割を持つスペースの一覧」から読む（取るのは 2 回。全ワークスペースの
 *   一覧はたどらない）
 * - spaceId 無し: 所属ワークスペースを順に見て、最初に見つかったスペースへ移す（どこへ移すかを
 *   決めるのに一覧が要る）
 *
 * スペースの一覧は左の列やスペース切替と同じ共有の問い合わせなので、同じものを 2 回取らず、
 * スペースの改名や作成はここにもそのまま届く（解決の結果を別に控えない）。
 *
 * `preferredWorkspaceSlug` は spaceId 無し（/kb/spaces）のときだけ効く。スペース切替の
 * 「すべてのスペース」が対象ワークスペースを持ち越すために渡す。
 * spaceId が既にあれば、その ID から一意にワークスペースが決まるので使わない。
 *
 * 見つからない（notFound）と読み込めなかった（error）は分けて返す。前者は戻り先を示し、
 * 後者は取り直し（retry）を置く。
 */
export function useKbSpaceEntry(
  spaceId: string | undefined,
  onResolvedEntrySpaceId: (id: string) => void,
  preferredWorkspaceSlug?: string,
) {
  const queryClient = useQueryClient();
  const byId = spaceId !== undefined;

  // spaceId あり: 所在 → そのワークスペースの一覧 1 つ。
  const locationResult = useQuery({ ...kbSpaceLocationQuery(spaceId ?? ''), enabled: byId });
  const location = queryShownState(locationResult, byId);
  const locatedSlug = location.data?.workspaceSlug;
  const locatedListResult = useQuery({ ...kbMySpacesQuery(locatedSlug ?? ''), enabled: locatedSlug !== undefined });
  const locatedList = queryShownState(locatedListResult, locatedSlug !== undefined);

  // spaceId 無し: 所属ワークスペースを順に見る。
  const workspaces = useQuery({ ...workspacesQuery(), enabled: !byId });
  const ordered = byId ? NO_WORKSPACES : orderWorkspaces(workspaces.data ?? NO_WORKSPACES, preferredWorkspaceSlug);
  const lists = useQueries({ queries: ordered.map((w) => kbMySpacesQuery(w.slug)) });
  const states: MySpacesState[] = ordered.map((w, i) => ({
    workspaceSlug: w.slug,
    data: lists[i]?.data,
    isError: lists[i]?.isError ?? false,
    isFetching: lists[i]?.isFetching ?? false,
  }));

  let state: KbSpaceEntryState;
  let entrySpaceId: string | null = null;
  if (spaceId) {
    const located = locateKbSpace(
      spaceId,
      { owner: locatedSlug, lostAccess: location.lostAccess, failed: location.failed },
      {
        data: locatedList.data,
        lostAccess: locatedList.lostAccess,
        failed: locatedList.failed,
        isFetching: locatedListResult.isFetching,
      },
    );
    state =
      located.kind === 'found'
        ? { ...EMPTY, workspaceSlug: located.value.workspaceSlug, space: located.value.space }
        : { ...stateOf(located), notFound: located.kind === 'none' };
  } else if (workspaces.data === undefined) {
    state = workspaces.isError && !workspaces.isFetching ? { ...EMPTY, error: LOAD_ERROR } : { ...EMPTY, loading: true };
  } else {
    const entry = pickEntryKbSpace(states);
    // 見つかったら移るまで読み込み中のまま（移った先の画面が続きを出す）。
    if (entry.kind === 'found') entrySpaceId = entry.value;
    state = entry.kind === 'found' ? { ...EMPTY, loading: true } : { ...stateOf(entry), noSpaces: entry.kind === 'none' };
  }

  const resolveEntry = useEffectEvent((id: string) => onResolvedEntrySpaceId(id));
  useEffect(() => {
    if (entrySpaceId) resolveEntry(entrySpaceId);
  }, [entrySpaceId]);

  // 読めなかったものだけを取り直す（読めているものまで取り直して待たせない）。所属の一覧の鍵は
  // 鍵の根なので、ワークスペースごとのスペースの一覧もこの鍵の下に入る。所在の鍵は根の外にある。
  const retry = useCallback(() => {
    for (const queryKey of [workspacesQuery().queryKey, kbKeys.spaceLocations()]) {
      void queryClient.refetchQueries({
        queryKey,
        type: 'active',
        predicate: (query) => query.state.status === 'error',
      });
    }
  }, [queryClient]);

  return { ...state, retry };
}

function stateOf(resolution: KbSpaceResolution<unknown>): KbSpaceEntryState {
  if (resolution.kind === 'loading') return { ...EMPTY, loading: true };
  if (resolution.kind === 'error') return { ...EMPTY, error: LOAD_ERROR };
  return EMPTY;
}
