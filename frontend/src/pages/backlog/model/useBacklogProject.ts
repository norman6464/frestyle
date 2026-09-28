import { useCallback, useEffect, useEffectEvent } from 'react';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { workspacesQuery, type Workspace, workspaceKeys } from '@/entities/workspace';
import { projectListQuery, type Project } from '@/entities/project';
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
 * 前者は最初に見つかったプロジェクトへ移す。後者は projectId からワークスペースを引く。
 *
 * 所属ワークスペースと、それぞれのプロジェクトの一覧を共有の問い合わせから読み、そこから導く
 * （解決の結果を別に控えない）。プロジェクトの切替・ホームの作成の窓と同じ一覧を使うので、
 * 画面を移るたびに全ワークスペースを引き直さない。
 *
 * 見つからない（notFound）と読み込めなかった（error）は分けて返す。前者は戻り先を示し、
 * 後者は取り直し（retry）を置く。
 */
export function useBacklogProject(projectId: string | undefined, onResolvedEntryProjectId: (id: string) => void) {
  const queryClient = useQueryClient();
  const workspaces = useQuery(workspacesQuery());
  const ordered = workspaces.data ?? NO_WORKSPACES;
  const lists = useQueries({ queries: ordered.map((w) => projectListQuery(w.slug)) });
  const states: ProjectListState[] = ordered.map((w, i) => ({
    owner: w.slug,
    data: lists[i]?.data,
    isError: lists[i]?.isError ?? false,
    isFetching: lists[i]?.isFetching ?? false,
  }));

  let state: BacklogProjectState;
  let entryProjectId: string | null = null;
  if (workspaces.data === undefined) {
    state = workspaces.isError && !workspaces.isFetching ? { ...EMPTY, error: LOAD_ERROR } : { ...EMPTY, loading: true };
  } else if (projectId) {
    const located = locateBacklogProject(projectId, states);
    state =
      located.kind === 'found'
        ? { ...EMPTY, workspaceSlug: located.owner, project: located.item }
        : { ...stateOf(located), notFound: located.kind === 'none' };
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

  // 読めなかった一覧だけを取り直す（読めている一覧まで取り直して待たせない）。
  const retry = useCallback(() => {
    void queryClient.refetchQueries({
      queryKey: workspaceKeys.all(),
      type: 'active',
      predicate: (query) => query.state.status === 'error',
    });
  }, [queryClient]);

  return { ...state, retry };
}

function stateOf(resolution: AcrossListsResolution<unknown>): BacklogProjectState {
  if (resolution.kind === 'loading') return { ...EMPTY, loading: true };
  if (resolution.kind === 'error') return { ...EMPTY, error: LOAD_ERROR };
  return EMPTY;
}
