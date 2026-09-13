import { useEffect, useRef, useState } from 'react';
import type { KbSpace } from '@/entities/kb';
import { resolveBacklogSpace, resolveBacklogSpaceId } from './resolveBacklogSpace';

export interface BacklogSpaceState {
  workspaceSlug: string | null;
  space: KbSpace | null;
  /** スペースが 1 つも無い（ワークスペースはあるがスペースが無い）。 */
  noSpaces: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: BacklogSpaceState = { workspaceSlug: null, space: null, noSpaces: false, loading: false, error: null };

/**
 * useBacklogSpace は /kb/backlog（spaceId 無し）と /kb/backlog/:spaceId の両方を解決する。
 * 前者は最初に見つかったスペースへ移す（設計 Ⅹ・既定 a）。後者は spaceId から
 * ワークスペースを引く（設計 Ⅳ-H）。
 */
export function useBacklogSpace(spaceId: string | undefined, onResolvedEntrySpaceId: (id: string) => void) {
  const [state, setState] = useState<BacklogSpaceState>(EMPTY);
  const active = useRef<string>('');

  useEffect(() => {
    const key = spaceId ?? '__entry__';
    active.current = key;
    setState({ ...EMPTY, loading: true });

    if (!spaceId) {
      resolveBacklogSpaceId()
        .then((id) => {
          if (active.current !== key) return;
          if (id) {
            onResolvedEntrySpaceId(id);
            return;
          }
          setState({ ...EMPTY, noSpaces: true, loading: false });
        })
        .catch(() => {
          if (active.current !== key) return;
          setState({ ...EMPTY, error: 'バックログを読み込めませんでした。' });
        });
      return;
    }

    resolveBacklogSpace(spaceId)
      .then((resolved) => {
        if (active.current !== key) return;
        if (!resolved) {
          setState({ ...EMPTY, error: 'このスペースは見つかりませんでした。' });
          return;
        }
        setState({
          workspaceSlug: resolved.workspaceSlug,
          space: resolved.space,
          noSpaces: false,
          loading: false,
          error: null,
        });
      })
      .catch(() => {
        if (active.current !== key) return;
        setState({ ...EMPTY, error: 'バックログを読み込めませんでした。' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  return state;
}
