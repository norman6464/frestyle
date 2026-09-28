import { queryOptions } from '@tanstack/react-query';
import { projectScope, workspaceScope } from '@/shared/api/queryKeys';
import TicketRepository from './ticketRepository';
import type { TicketListFilter } from '../model/types';

/**
 * チケットの鍵。ラベルはワークスペースの中（ページとチケットで共有する語彙）、状態と種別は
 * プロジェクトの中に置く（鍵の根は shared/api/queryKeys.ts）。
 */
export const ticketKeys = {
  /** ワークスペースのラベルの定義。 */
  labels: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'labels'] as const,
  /** プロジェクトの状態（使っていないもの。使用中の件数つき）。 */
  statuses: (workspaceSlug: string, projectId: string) =>
    [...projectScope(workspaceSlug, projectId), 'statuses'] as const,
  /** プロジェクトの種別（使っていないもの。使用中の件数つき）。 */
  types: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'types'] as const,
  /** ワークスペースで自分に割り当たっているチケット（担当の画面）。 */
  assigned: (workspaceSlug: string) => [...workspaceScope(workspaceSlug), 'assigned-tickets'] as const,
  /** 全ワークスペース横断の自分の担当（ホーム・上限つき）。ワークスペースをまたぐ。 */
  myAssigned: (limit: number) => ['my-assigned-tickets', limit] as const,
  /** 自分の担当のすべて（ワークスペースをまたぐもの）。チケットを書き換えたらこの鍵でまとめて古くする。 */
  allMyAssigned: () => ['my-assigned-tickets'] as const,
  /** ページを本文で参照しているチケット（上限つき）。 */
  pageReferences: (workspaceSlug: string, pageId: string, limit: number) =>
    [...workspaceScope(workspaceSlug), 'page', pageId, 'ticket-references', limit] as const,
  /** プロジェクトのチケットの一覧すべて（絞り込みごとの一覧を束ねる）。 */
  lists: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'ticket-list'] as const,
  /** プロジェクトのチケットの一覧（絞り込みごと。条件の無い項目は鍵に入らない）。 */
  list: (workspaceSlug: string, projectId: string, filter: TicketListFilter) =>
    [...projectScope(workspaceSlug, projectId), 'ticket-list', filter] as const,
  /** バックログの見出しの件数（全件・自分の担当・期限切れ・未割り当て）。 */
  counts: (workspaceSlug: string, projectId: string) => [...projectScope(workspaceSlug, projectId), 'ticket-counts'] as const,
  /** 本人がそのプロジェクトで保存した絞り込み（件数つき）。 */
  savedFilters: (workspaceSlug: string, projectId: string) =>
    [...projectScope(workspaceSlug, projectId), 'saved-filters'] as const,
  /** チケット 1 件を ID だけで解決したもの（ワークスペース・祖先・権限つき）。ワークスペースを知らずに開くのでワークスペースの外。 */
  resolved: (ticketId: string) => ['resolved-tickets', ticketId] as const,
  /** 解決したチケットのすべて。親を変えると子孫の祖先の列も変わるので、この鍵でまとめて古くする。 */
  allResolved: () => ['resolved-tickets'] as const,
};

/** ワークスペースのラベルの定義。バックログ・チケットの画面が共有する。 */
export function ticketLabelsQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: ticketKeys.labels(workspaceSlug),
    queryFn: () => TicketRepository.fetchLabels(workspaceSlug),
  });
}

/** プロジェクトの状態。バックログ・チケットの画面・ホームの作成の窓が共有する。 */
export function ticketStatusesQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: ticketKeys.statuses(workspaceSlug, projectId),
    queryFn: () => TicketRepository.fetchTicketStatuses(workspaceSlug, projectId),
  });
}

/** プロジェクトの種別。バックログ・チケットの画面が共有する。 */
export function ticketTypesQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: ticketKeys.types(workspaceSlug, projectId),
    queryFn: () => TicketRepository.fetchTicketTypes(workspaceSlug, projectId),
  });
}

/** ワークスペースで自分に割り当たっているチケット（backend が状態の枠 → 並び → 期限の順に並べる）。 */
export function assignedTicketsQuery(workspaceSlug: string) {
  return queryOptions({
    queryKey: ticketKeys.assigned(workspaceSlug),
    queryFn: () => TicketRepository.fetchAssignedTickets(workspaceSlug),
  });
}

/** 全ワークスペース横断の自分の担当（未完了・期限の近い順・上限つき）。 */
export function myAssignedTicketsQuery(limit: number) {
  return queryOptions({
    queryKey: ticketKeys.myAssigned(limit),
    queryFn: ({ signal }) => TicketRepository.fetchMyAssignedTickets(limit, signal),
  });
}

/** ページを本文で参照しているチケット（上限つき）。バックログを見られない人には空が返る。 */
export function pageTicketReferencesQuery(workspaceSlug: string, pageId: string, limit: number) {
  return queryOptions({
    queryKey: ticketKeys.pageReferences(workspaceSlug, pageId, limit),
    queryFn: ({ signal }) => TicketRepository.fetchPageTicketReferences(workspaceSlug, pageId, limit, signal),
  });
}

/** プロジェクトのチケットの一覧（絞り込みごと）。 */
export function ticketListQuery(workspaceSlug: string, projectId: string, filter: TicketListFilter) {
  return queryOptions({
    queryKey: ticketKeys.list(workspaceSlug, projectId, filter),
    queryFn: () => TicketRepository.fetchTickets(workspaceSlug, projectId, filter),
  });
}

/** バックログの見出しの件数。 */
export function ticketCountsQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: ticketKeys.counts(workspaceSlug, projectId),
    queryFn: () => TicketRepository.fetchTicketCounts(workspaceSlug, projectId),
  });
}

/** 本人がそのプロジェクトで保存した絞り込み（件数つき）。 */
export function savedFiltersQuery(workspaceSlug: string, projectId: string) {
  return queryOptions({
    queryKey: ticketKeys.savedFilters(workspaceSlug, projectId),
    queryFn: () => TicketRepository.fetchSavedFilters(workspaceSlug, projectId),
  });
}

/** チケット 1 件を ID だけで解決する（通知・本文中の参照・ブックマークからはワークスペースを知らずに来る）。 */
export function resolvedTicketQuery(ticketId: string) {
  return queryOptions({
    queryKey: ticketKeys.resolved(ticketId),
    queryFn: () => TicketRepository.resolveTicket(ticketId),
  });
}
