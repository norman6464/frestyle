import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { ticketChildrenQuery, type Ticket } from '@/entities/ticket';

const LOAD_FAILED = '子チケットを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';
const NO_CHILDREN: Ticket[] = [];

const countOf = (children: Ticket[]) => children.length;

/**
 * useTicketChildren はチケット 1 件の直下の子（孫は含まない）を読む。
 *
 * 書き込みはここでは持たない — 子を作る・親を付け替える操作は、そのチケット自身を
 * 開いたときの「親」欄（useTicketPage 等）から行う。ここは表示専用の一覧。共有の問い合わせ
 * （ticketChildrenQuery）から読むので、子の状態や題名を書き換えれば（reflectTicket）ここにも映り、
 * 親を付け替えれば（refreshTicketHierarchy）取り直す。
 */
export function useTicketChildren(workspaceSlug: string | undefined, ticketId: string | undefined) {
  const active = workspaceSlug !== undefined && ticketId !== undefined;
  const result = useQuery({ ...ticketChildrenQuery(workspaceSlug ?? '', ticketId ?? ''), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);

  const { refetch } = result;
  const refresh = useCallback(() => {
    if (active) void refetch();
  }, [active, refetch]);

  return { children: data ?? NO_CHILDREN, loading, error: failed ? LOAD_FAILED : null, refresh };
}

/**
 * useTicketChildCount は見出しに出す子の件数。節の中身（useTicketChildren）と同じ結果を使うので
 * 取り直さない。まだ読めていない・読めなかった間は undefined（0 と取り違えない）。
 */
export function useTicketChildCount(workspaceSlug: string, ticketId: string): number | undefined {
  const result = useQuery({ ...ticketChildrenQuery(workspaceSlug, ticketId), select: countOf });
  return queryShownState(result).data;
}
