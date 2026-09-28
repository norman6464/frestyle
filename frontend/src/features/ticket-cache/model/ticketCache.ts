import type { QueryClient } from '@tanstack/react-query';
import { reflectWrite, reflectWriteAll } from '@/shared/api/queryCache';
import { resolvedTicketQuery, ticketKeys, type Ticket } from '@/entities/ticket';
import { sprintKeys } from '@/entities/sprint';

/**
 * reflectTicket は、書き換えたチケットの新しい値を、そのチケットを載せている控え（プロジェクトの
 * 一覧すべてとチケットの画面）へ映す。載せていない一覧には触らない。飛んでいる取得は止めてから
 * 映す（書き込みより前の古い結果があとから届いて、映した値を上書きしない）。
 */
export async function reflectTicket(
  queryClient: QueryClient,
  workspaceSlug: string,
  projectId: string,
  ticketId: string,
  update: (ticket: Ticket) => Ticket,
): Promise<void> {
  await Promise.all([
    reflectWriteAll<Ticket[]>(queryClient, ticketKeys.lists(workspaceSlug, projectId), (tickets) =>
      tickets.some((t) => t.id === ticketId) ? tickets.map((t) => (t.id === ticketId ? update(t) : t)) : tickets,
    ),
    reflectWrite(queryClient, resolvedTicketQuery(ticketId).queryKey, (resolved) => ({
      ...resolved,
      ticket: update(resolved.ticket),
    })),
  ]);
}

/**
 * refreshTicketDerived は、チケットの書き込みで変わりうる派生を古いものにする。見ている派生だけ
 * 取り直す（見ていないものは次に使うときに取り直す）。
 *
 * - プロジェクトのチケットの一覧: 絞り込みへの出入り・並びが変わる。見ている一覧は書き込みの応答で
 *   直してあるので取り直さず、古い印だけ付ける（直した行が取り直しで急に消えたり動いたりしない）
 * - 件数・保存した絞り込みの件数・状態と種別の使用中の件数・担当の一覧・スプリントの件数
 */
export function refreshTicketDerived(queryClient: QueryClient, workspaceSlug: string, projectId: string): void {
  void queryClient.invalidateQueries({ queryKey: ticketKeys.lists(workspaceSlug, projectId), refetchType: 'none' });
  for (const queryKey of [
    ticketKeys.counts(workspaceSlug, projectId),
    ticketKeys.savedFilters(workspaceSlug, projectId),
    ticketKeys.statuses(workspaceSlug, projectId),
    ticketKeys.types(workspaceSlug, projectId),
    ticketKeys.assigned(workspaceSlug),
    ticketKeys.allMyAssigned(),
    sprintKeys.list(workspaceSlug, projectId),
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
}

/**
 * refreshTicketAncestry は親を変えたあとに、解決したチケット（祖先の列つき）をすべて古くする。
 * 祖先の列は書き込みの応答に入っておらず、動かしたチケットの子孫の列も変わるので、手元では直せない。
 * 開いている画面のぶんだけ取り直し、それを待つ。
 */
export function refreshTicketAncestry(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: ticketKeys.allResolved() });
}
