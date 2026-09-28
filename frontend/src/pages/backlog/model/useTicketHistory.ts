import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { ticketHistoryQuery, type TicketChangeGroup } from '@/entities/ticket';

const NO_HISTORY: TicketChangeGroup[] = [];

/**
 * useTicketHistory は開いているチケットの変更履歴を読む。
 *
 * チケット本体（title / doc / 状態 等）は一覧や解決の応答に既に全項目が入っているので、ここで
 * 持つのは応答に含まれない履歴（`GET .../history`）だけ。共有の問い合わせ（ticketHistoryQuery）
 * から読み、チケットを書き換えたら書き込みの側（features/ticket-cache の reflectTicket）が
 * 古いものにするので、書いた直後に新しい行が出る。
 */
export function useTicketHistory(workspaceSlug: string | undefined, ticketId: string | null) {
  const active = workspaceSlug !== undefined && ticketId !== null;
  const result = useQuery({ ...ticketHistoryQuery(workspaceSlug ?? '', ticketId ?? ''), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);
  return { history: data ?? NO_HISTORY, loading, error: failed ? '変更履歴を読み込めませんでした。' : null };
}
