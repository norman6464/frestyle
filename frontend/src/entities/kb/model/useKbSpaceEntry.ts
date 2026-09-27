import { useCallback, useEffect, useRef, useState } from 'react';
import type { KbMySpace } from './types';
import { resolveEntryKbSpaceId, resolveKbSpace } from './resolveKbSpace';

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

/**
 * useKbSpaceEntry は /kb/spaces（spaceId 無し）と /kb/spaces/:spaceId の両方を解決する
 * （段14。概要・すべてのページ・お気に入り・メンバーの 4 画面が共有する）。
 * pages/backlog/model/useBacklogSpace.ts と同じ形（前者は最初に見つかったスペースへ
 * 移す・後者は spaceId からワークスペースを引く）。
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
  const [state, setState] = useState<KbSpaceEntryState>(EMPTY);
  const [attempt, setAttempt] = useState(0);
  const active = useRef<string>('');

  useEffect(() => {
    const key = `${spaceId ?? `__entry__:${preferredWorkspaceSlug ?? ''}`}#${attempt}`;
    active.current = key;
    setState({ ...EMPTY, loading: true });

    if (!spaceId) {
      resolveEntryKbSpaceId(preferredWorkspaceSlug)
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
          setState({ ...EMPTY, notFound: true });
          return;
        }
        setState({ ...EMPTY, workspaceSlug: resolved.workspaceSlug, space: resolved.space });
      })
      .catch(() => {
        if (active.current !== key) return;
        setState({ ...EMPTY, error: 'スペースを読み込めませんでした。' });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spaceId, preferredWorkspaceSlug, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { ...state, retry };
}
