import { useEffect, useRef, useState } from 'react';
import type { KbMySpace } from './types';
import { resolveEntryKbSpaceId, resolveKbSpace } from './resolveKbSpace';

export interface KbSpaceEntryState {
  workspaceSlug: string | null;
  space: KbMySpace | null;
  /** アクセスできるスペースが 1 つも無い（ワークスペースはあるがスペースが無い/役割が無い）。 */
  noSpaces: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY: KbSpaceEntryState = { workspaceSlug: null, space: null, noSpaces: false, loading: false, error: null };

/**
 * useKbSpaceEntry は /kb/spaces（spaceId 無し）と /kb/spaces/:spaceId の両方を解決する
 * （段14。概要・すべてのページ・お気に入り・メンバーの 4 画面が共有する）。
 * pages/backlog/model/useBacklogSpace.ts と同じ形（前者は最初に見つかったスペースへ
 * 移す・後者は spaceId からワークスペースを引く）。
 */
export function useKbSpaceEntry(spaceId: string | undefined, onResolvedEntrySpaceId: (id: string) => void) {
  const [state, setState] = useState<KbSpaceEntryState>(EMPTY);
  const active = useRef<string>('');

  useEffect(() => {
    const key = spaceId ?? '__entry__';
    active.current = key;
    setState({ ...EMPTY, loading: true });

    if (!spaceId) {
      resolveEntryKbSpaceId()
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
          setState({ ...EMPTY, error: 'スペースを読み込めませんでした。' });
        });
      return;
    }

    resolveKbSpace(spaceId)
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
        setState({ ...EMPTY, error: 'スペースを読み込めませんでした。' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId]);

  return state;
}
