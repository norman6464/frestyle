import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '@/entities/project';
import { resolveBacklogProject, resolveEntryProjectId } from './resolveBacklogProject';

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

/**
 * useBacklogProject は /backlog（projectId 無し）と /backlog/:projectId の両方を解決する。
 * 前者は最初に見つかったプロジェクトへ移す。後者は projectId からワークスペースを引く。
 *
 * 見つからない（notFound）と読み込めなかった（error）は分けて返す。前者は戻り先を示し、
 * 後者は取り直し（retry）を置く。
 */
export function useBacklogProject(projectId: string | undefined, onResolvedEntryProjectId: (id: string) => void) {
  const [state, setState] = useState<BacklogProjectState>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const active = useRef<string>('');

  useEffect(() => {
    const key = `${projectId ?? '__entry__'}#${attempt}`;
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
          setState({ ...EMPTY, notFound: true });
          return;
        }
        setState({ ...EMPTY, workspaceSlug: resolved.workspaceSlug, project: resolved.project });
      })
      .catch(() => {
        if (active.current !== key) return;
        setState({ ...EMPTY, error: 'バックログを読み込めませんでした。' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
