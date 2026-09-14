import { useEffect, useRef, useState } from 'react';
import type { Project } from '@/entities/project';
import { resolveBacklogProject, resolveEntryProjectId } from './resolveBacklogProject';

export interface BacklogProjectState {
  workspaceSlug: string | null;
  project: Project | null;
  /** プロジェクトが 1 つも無い（ワークスペースはあるが入れ物が無い）。 */
  noProjects: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: BacklogProjectState = {
  workspaceSlug: null,
  project: null,
  noProjects: false,
  loading: false,
  error: null,
};

/**
 * useBacklogProject は /backlog（projectId 無し）と /backlog/:projectId の両方を解決する。
 * 前者は最初に見つかったプロジェクトへ移す。後者は projectId からワークスペースを引く。
 */
export function useBacklogProject(projectId: string | undefined, onResolvedEntryProjectId: (id: string) => void) {
  const [state, setState] = useState<BacklogProjectState>(EMPTY);
  const active = useRef<string>('');

  useEffect(() => {
    const key = projectId ?? '__entry__';
    active.current = key;
    setState({ ...EMPTY, loading: true });

    if (!projectId) {
      resolveEntryProjectId()
        .then((id) => {
          if (active.current !== key) return;
          if (id) {
            onResolvedEntryProjectId(id);
            return;
          }
          setState({ ...EMPTY, noProjects: true, loading: false });
        })
        .catch(() => {
          if (active.current !== key) return;
          setState({ ...EMPTY, error: 'バックログを読み込めませんでした。' });
        });
      return;
    }

    resolveBacklogProject(projectId)
      .then((resolved) => {
        if (active.current !== key) return;
        if (!resolved) {
          setState({ ...EMPTY, error: 'このプロジェクトは見つかりませんでした。' });
          return;
        }
        setState({
          workspaceSlug: resolved.workspaceSlug,
          project: resolved.project,
          noProjects: false,
          loading: false,
          error: null,
        });
      })
      .catch(() => {
        if (active.current !== key) return;
        setState({ ...EMPTY, error: 'バックログを読み込めませんでした。' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  return state;
}
