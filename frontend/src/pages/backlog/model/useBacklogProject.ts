import { useCallback, useEffect, useEffectEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { workspacesQuery, type Workspace, workspaceKeys } from '@/entities/workspace';
import { projectKeys, projectListQuery, projectLocationQuery, type Project } from '@/entities/project';
import type { AcrossListsResolution } from '@/shared/lib/acrossLists';
import { locateBacklogProject, resolveEntryProject, type ProjectListState } from './resolveBacklogProject';

export interface BacklogProjectState {
  workspaceSlug: string | null;
  project: Project | null;
  /** プロジェクトが 1 つも無い（ワークスペースはあるが入れ物が無い）。 */
  noProjects: boolean;
  /** 指定のプロジェクトが見つからない（消された・見る立場でない）。取り直しても変わらない。 */
  notFound: boolean;
  loading: boolean;
  /** 読み込めなかった（通信の失敗など）。取り直せば戻りうる。 */
  error: string | null;
}

const EMPTY: BacklogProjectState = {
  workspaceSlug: null,
  project: null,
  noProjects: false,
  notFound: false,
  loading: false,
  error: null,
};

const NO_WORKSPACES: Workspace[] = [];
const LOAD_ERROR = 'バックログを読み込めませんでした。';

/**
 * useBacklogProject は /backlog（projectId 無し）と /backlog/:projectId の両方を解決する。
 *
 * - projectId あり: 所在の口（/projects/:projectId）でどのワークスペースかを引き、プロジェクトそのものは
 *   そのワークスペースのプロジェクトの一覧から読む（取るのは 2 回。全ワークスペースの一覧はたどらない）
 * - projectId 無し: 所属ワークスペースを順に見て、最初に見つかったプロジェクトへ移す（どこへ移すかを
 *   決めるのに一覧が要る）
 *
 * プロジェクトの一覧はプロジェクトの切替・ホームの作成の窓と同じ共有の問い合わせなので、同じものを
 * 2 回取らず、改名もここにそのまま届く（解決の結果を別に控えない）。
 *
 * 見つからない（notFound）と読み込めなかった（error）は分けて返す。前者は戻り先を示し、
 * 後者は取り直し（retry）を置く。
 */
export function useBacklogProject(projectId: string | undefined, onResolvedEntryProjectId: (id: string) => void) {
  const queryClient = useQueryClient();
  const byId = projectId !== undefined;

  // projectId あり: 所在 → そのワークスペースの一覧 1 つ。
  const locationResult = useQuery({ ...projectLocationQuery(projectId ?? ''), enabled: byId });
  const location = queryShownState(locationResult, byId);
  const locatedSlug = location.data?.workspaceSlug;
  const locatedListResult = useQuery({ ...projectListQuery(locatedSlug ?? ''), enabled: locatedSlug !== undefined });
  const locatedList = queryShownState(locatedListResult, locatedSlug !== undefined);

  // projectId 無し: 所属ワークスペースを順に見る。
  const workspaces = useQuery({ ...workspacesQuery(), enabled: !byId });
  const ordered = byId ? NO_WORKSPACES : (workspaces.data ?? NO_WORKSPACES);
  const lists = useQueries({ queries: ordered.map((w) => projectListQuery(w.slug)) });
  const states: ProjectListState[] = ordered.map((w, i) => ({
    owner: w.slug,
    data: lists[i]?.data,
    isError: lists[i]?.isError ?? false,
    isFetching: lists[i]?.isFetching ?? false,
  }));

  let state: BacklogProjectState;
  let entryProjectId: string | null = null;
  if (projectId) {
    const located = locateBacklogProject(
      projectId,
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
        ? { ...EMPTY, workspaceSlug: located.owner, project: located.item }
        : { ...stateOf(located), notFound: located.kind === 'none' };
  } else if (workspaces.data === undefined) {
    state = workspaces.isError && !workspaces.isFetching ? { ...EMPTY, error: LOAD_ERROR } : { ...EMPTY, loading: true };
  } else {
    const entry = resolveEntryProject(states);
    // 見つかったら移るまで読み込み中のまま（移った先の画面が続きを出す）。
    if (entry.kind === 'found') entryProjectId = entry.item.id;
    state = entry.kind === 'found' ? { ...EMPTY, loading: true } : { ...stateOf(entry), noProjects: entry.kind === 'none' };
  }

  const resolveEntry = useEffectEvent((id: string) => onResolvedEntryProjectId(id));
  useEffect(() => {
    if (entryProjectId) resolveEntry(entryProjectId);
  }, [entryProjectId]);

  // 読めなかったものだけを取り直す（読めているものまで取り直して待たせない）。プロジェクトの一覧は
  // ワークスペースの鍵の根の下にある。所在の鍵は根の外にある。
  const retry = useCallback(() => {
    for (const queryKey of [workspaceKeys.all(), projectKeys.locations()]) {
      void queryClient.refetchQueries({
        queryKey,
        type: 'active',
        predicate: (query) => query.state.status === 'error',
      });
    }
  }, [queryClient]);

  return { ...state, retry };
}

function stateOf(resolution: AcrossListsResolution<unknown>): BacklogProjectState {
  if (resolution.kind === 'loading') return { ...EMPTY, loading: true };
  if (resolution.kind === 'error') return { ...EMPTY, error: LOAD_ERROR };
  return EMPTY;
}
