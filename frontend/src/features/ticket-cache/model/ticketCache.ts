import type { QueryClient } from '@tanstack/react-query';
import { reflectWrite, reflectWriteAll } from '@/shared/api/queryCache';
import { resolvedTicketQuery, ticketKeys, type Ticket } from '@/entities/ticket';
import { sprintKeys } from '@/entities/sprint';

/**
 * reflectTicket は、書き換えたチケットの新しい値を、そのチケットを載せている控え（プロジェクトの
 * 一覧すべて・親の「子」の一覧・チケットの画面）へ映す。載せていない一覧には触らない。飛んでいる
 * 取得は止めてから映す（書き込みより前の古い結果があとから届いて、映した値を上書きしない）。
 * 書き込みはそのチケットの変更履歴に 1 行足すので、履歴は古くする（応答からは作れない）。
 */
export async function reflectTicket(
  queryClient: QueryClient,
  workspaceSlug: string,
  projectId: string,
  ticketId: string,
  update: (ticket: Ticket) => Ticket,
): Promise<void> {
  const inList = (tickets: Ticket[]) =>
    tickets.some((t) => t.id === ticketId) ? tickets.map((t) => (t.id === ticketId ? update(t) : t)) : tickets;
  await Promise.all([
    reflectWriteAll<Ticket[]>(queryClient, ticketKeys.lists(workspaceSlug, projectId), inList),
    reflectWriteAll<Ticket[]>(queryClient, ticketKeys.allChildren(workspaceSlug), inList),
    reflectWrite(queryClient, resolvedTicketQuery(ticketId).queryKey, (resolved) => ({
      ...resolved,
      ticket: update(resolved.ticket),
    })),
  ]);
  void queryClient.invalidateQueries({ queryKey: ticketKeys.history(workspaceSlug, ticketId) });
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
 * refreshTicketHierarchy は親を変えたあとに、親子の形に頼る控えをすべて古くする。
 *
 * - 解決したチケット（祖先の列つき）: 祖先の列は書き込みの応答に入っておらず、動かしたチケットの
 *   子孫の列も変わる
 * - 「子」の一覧: 元の親から抜け、新しい親に入る。元の親は応答からは分からない
 *
 * 手元では直せないので、開いている画面のぶんだけ取り直し、それを待つ。
 */
export async function refreshTicketHierarchy(queryClient: QueryClient, workspaceSlug: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ticketKeys.allResolved() }),
    queryClient.invalidateQueries({ queryKey: ticketKeys.allChildren(workspaceSlug) }),
  ]);
}
