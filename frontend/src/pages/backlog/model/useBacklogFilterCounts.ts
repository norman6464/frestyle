import { useCallback, useEffect, useRef, useState } from 'react';
import { TicketRepository, type TicketCounts } from '@/entities/ticket';

interface CountsTarget {
  key: string;
  workspaceSlug: string;
  projectId: string;
}

function targetOf(workspaceSlug: string | undefined, projectId: string | undefined): CountsTarget | null {
  if (!workspaceSlug || !projectId) return null;
  return { key: `${workspaceSlug} ${projectId}`, workspaceSlug, projectId };
}

export interface BacklogFilterCounts {
  /** 件数。まだ取れていなければ null。 */
  counts: TicketCounts | null;
  /**
   * 直前の取得が失敗した。画面は数字の代わりに「—」を出す（古い数字を出し続けると
   * 「動かしたのに減らない」と読まれる。0 と同じ表示にすると失敗が隠れる）。
   */
  failed: boolean;
  /** チケットを動かしたあとに取り直す。 */
  refresh: () => void;
}

/**
 * useBacklogFilterCounts はバックログの見出しの固定の「保存した絞り込み」の件数バッジ
 * （自分の担当・期限切れ・未割り当て）と全件数を読む。件数はワークスペース全チケットの走査と
 * 自分の principal 解決が要るため、backend の GetTicketCounts を叩くだけでフロントでは
 * 計算しない。
 *
 * 失敗しても画面は塞がない（件数は絞り込みの補助表示でしかなく、ここでエラーを出しても
 * 行き止まりにしかならない）。ただし失敗したことは `failed` で表に出す。
 */
export function useBacklogFilterCounts(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
): BacklogFilterCounts {
  const [counts, setCounts] = useState<TicketCounts | null>(null);
  const [failed, setFailed] = useState(false);
  const active = useRef<CountsTarget | null>(null);
  const seq = useRef(0);
  const target = targetOf(workspaceSlug, projectId);
  const targetKey = target?.key ?? null;

  const load = useCallback((to: CountsTarget) => {
    const request = ++seq.current;
    void TicketRepository.fetchTicketCounts(to.workspaceSlug, to.projectId)
      .then((result) => {
        if (active.current?.key !== to.key || seq.current !== request) return;
        setCounts(result);
        setFailed(false);
      })
      .catch(() => {
        if (active.current?.key !== to.key || seq.current !== request) return;
        setFailed(true);
      });
  }, []);

  useEffect(() => {
    active.current = target;
    if (!target) {
      seq.current += 1;
      setCounts(null);
      setFailed(false);
      return;
    }
    // プロジェクトを移ったら前の数字は捨てる（別のプロジェクトの件数を一瞬でも出さない）。
    setCounts(null);
    setFailed(false);
    load(target);
    // target は毎描画で作り直すオブジェクトなので、鍵で比べる（useKbPageTemplates と同じ形）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, load]);

  const refresh = useCallback(() => {
    if (active.current) load(active.current);
  }, [load]);

  return { counts, failed, refresh };
}
