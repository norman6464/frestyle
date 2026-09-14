import { useCallback, useEffect, useRef, useState } from 'react';
import { TicketRepository, type Ticket } from '@/entities/ticket';

/**
 * useTicketParentCandidates は「親を選ぶ」ピッカーの候補として、プロジェクト内の現役チケットを
 * まとめて読む（段2 の検索のような絞り込みクエリは無いので、手元で絞り込む — ラベルの
 * ピッカーと同じ考え方）。
 *
 * 周期・階層規則・深さ超過は候補では弾かない — 選んだ後の PUT .../parent が
 * 判定して 409 を返す（サーバー側の判定を二重に持たない。設計の原則どおり）。
 */
export function useTicketParentCandidates(workspaceSlug: string | undefined, projectId: string | undefined) {
  const [candidates, setCandidates] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<string | null>(null);

  const load = useCallback(async (slug: string, project: string) => {
    const key = `${slug} ${project}`;
    setLoading(true);
    setError(null);
    try {
      const list = await TicketRepository.fetchTickets(slug, project, {});
      if (active.current !== key) return;
      setCandidates(list);
    } catch {
      if (active.current !== key) return;
      setError('候補を読み込めませんでした。');
    } finally {
      if (active.current === key) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const key = workspaceSlug && projectId ? `${workspaceSlug} ${projectId}` : null;
    active.current = key;
    if (!workspaceSlug || !projectId) {
      setCandidates([]);
      return;
    }
    void load(workspaceSlug, projectId);
  }, [workspaceSlug, projectId, load]);

  return { candidates, loading, error };
}
