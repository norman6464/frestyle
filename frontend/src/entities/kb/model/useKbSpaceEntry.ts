import { useCallback, useEffect, useEffectEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { kbKeys, kbMySpacesQuery, kbWorkspacesQuery } from '../api/kbQueries';
import type { KbMySpace, KbWorkspace } from './types';
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

const NO_WORKSPACES: KbWorkspace[] = [];
const LOAD_ERROR = 'スペースを読み込めませんでした。';

/**
 * useKbSpaceEntry は /kb/spaces（spaceId 無し）と /kb/spaces/:spaceId の両方を解決する
 * （段14。概要・すべてのページ・お気に入り・メンバーの 4 画面が共有する）。
 * 前者は最初に見つかったスペースへ移す・後者は spaceId からワークスペースを引く。
 *
 * 所属ワークスペースと、それぞれの「自分が役割を持つスペースの一覧」を共有の問い合わせから読み、
 * そこから導く（解決の結果を別に控えない）。左の列やスペース切替と同じ一覧を使うので、
 * 同じものを 2 回取らず、スペースの改名や作成はここにもそのまま届く。
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
  const workspaces = useQuery(kbWorkspacesQuery());
  const ordered = orderWorkspaces(workspaces.data ?? NO_WORKSPACES, spaceId ? undefined : preferredWorkspaceSlug);
  const lists = useQueries({ queries: ordered.map((w) => kbMySpacesQuery(w.slug)) });
  const states: MySpacesState[] = ordered.map((w, i) => ({
    workspaceSlug: w.slug,
    data: lists[i]?.data,
    isError: lists[i]?.isError ?? false,
    isFetching: lists[i]?.isFetching ?? false,
  }));

  let state: KbSpaceEntryState;
  let entrySpaceId: string | null = null;
  if (workspaces.data === undefined) {
    state = workspaces.isError && !workspaces.isFetching ? { ...EMPTY, error: LOAD_ERROR } : { ...EMPTY, loading: true };
  } else if (spaceId) {
    const located = locateKbSpace(spaceId, states);
    state =
      located.kind === 'found'
        ? { ...EMPTY, workspaceSlug: located.value.workspaceSlug, space: located.value.space }
        : { ...stateOf(located), notFound: located.kind === 'none' };
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

  // 読めなかった一覧だけを取り直す（読めている一覧まで取り直して待たせない）。
  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      queryKey: kbKeys.workspaces(),
      type: 'active',
      predicate: (query) => query.state.status === 'error',
    });
  }, [queryClient]);

  return { ...state, retry };
}

function stateOf(resolution: KbSpaceResolution<unknown>): KbSpaceEntryState {
  if (resolution.kind === 'loading') return { ...EMPTY, loading: true };
  if (resolution.kind === 'error') return { ...EMPTY, error: LOAD_ERROR };
  return EMPTY;
}
