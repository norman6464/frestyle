import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { ticketListQuery, type Ticket, type TicketListFilter } from '@/entities/ticket';

const NO_FILTER: TicketListFilter = {};
const NO_CANDIDATES: Ticket[] = [];

/**
 * useTicketParentCandidates は「親を選ぶ」ピッカーの候補として、プロジェクト内の現役チケットを
 * まとめて読む（段2 の検索のような絞り込みクエリは無いので、手元で絞り込む — ラベルの
 * ピッカーと同じ考え方）。
 *
 * 候補は共有の問い合わせ（ticketListQuery の条件なし）から読む。バックログの絞り込んでいない
 * 現役の一覧と同じ控えなので、バックログで開いたピッカーは取り直さずに候補を出す。宛先が
 * そろわない間（ピッカーを開くまで）は問い合わせない。
 *
 * 周期・階層規則・深さ超過は候補では弾かない — 選んだ後の PUT .../parent が
 * 判定して 409 を返す（サーバー側の判定を二重に持たない。設計の原則どおり）。
 */
export function useTicketParentCandidates(workspaceSlug: string | undefined, projectId: string | undefined) {
  const active = workspaceSlug !== undefined && projectId !== undefined;
  const result = useQuery({ ...ticketListQuery(workspaceSlug ?? '', projectId ?? '', NO_FILTER), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);
  return {
    candidates: data ?? NO_CANDIDATES,
    loading,
    error: failed ? '候補を読み込めませんでした。' : null,
  };
}
