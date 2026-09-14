import { useEffect, useRef, useState } from 'react';
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

/**
 * useBacklogFilterCounts はバックログのサイドバー「保存した絞り込み」の件数バッジ
 * （自分の担当・期限切れ・未割り当て）を読む。件数はワークスペース全チケットの走査と
 * 自分の principal 解決が要るため、backend の GetTicketCounts を叩くだけでフロントでは
 * 計算しない。
 *
 * 失敗しても壊れず null（0 件と同じ表示）にする。件数は柱の補助表示でしかなく、
 * ここでエラーを出しても行き止まりにしかならない（fail-open）。
 */
export function useBacklogFilterCounts(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
): TicketCounts | null {
  const [counts, setCounts] = useState<TicketCounts | null>(null);
  const active = useRef<CountsTarget | null>(null);
  const seq = useRef(0);
  const target = targetOf(workspaceSlug, projectId);
  const targetKey = target?.key ?? null;

  useEffect(() => {
    active.current = target;
    if (!target) {
      seq.current += 1;
      setCounts(null);
      return;
    }
    const request = ++seq.current;
    void TicketRepository.fetchTicketCounts(target.workspaceSlug, target.projectId)
      .then((result) => {
        if (active.current?.key !== target.key || seq.current !== request) return;
        setCounts(result);
      })
      .catch(() => {
        if (active.current?.key !== target.key || seq.current !== request) return;
        setCounts(null);
      });
    // target は毎描画で作り直すオブジェクトなので、鍵で比べる（useKbPageTemplates と同じ形）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey]);

  return counts;
}
