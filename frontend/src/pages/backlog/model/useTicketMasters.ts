import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import {
  TicketRepository,
  ticketKeys,
  ticketStatusesQuery,
  ticketTypesQuery,
  type TicketStatus,
  type TicketStatusInput,
  type TicketType,
  type TicketTypeInput,
} from '@/entities/ticket';

const LOAD_FAILED = 'マスタを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';
const NO_STATUSES: TicketStatus[] = [];
const NO_TYPES: TicketType[] = [];

/**
 * useTicketMasters はプロジェクトの状態・種別マスタ（一覧・管理操作）を読み書きする。
 *
 * 一覧は共有の問い合わせ（ticketStatusesQuery / ticketTypesQuery）から読む。バックログと
 * チケットの画面・ホームの作成の窓が同じ結果を使うので、画面を行き来しても取り直さない。
 *
 * 状態/種別の変更はすべて **その一覧を取り直す**（設計 Ⅶ）。個々の応答（Create/Update は
 * activeTicketCount を持たない・SetInitial 等は 204）を局所的に反映しようとすると
 * 使用中件数が食い違うため、マスタに限っては「変更のたびに引き直す」の一択にしてある。
 * 状態を変えても種別は取り直さない（互いの一覧に影響しない）。
 *
 * 失敗はすべて例外として投げる（呼び出し側 TicketStatusAdmin / TicketTypeAdmin が
 * status_in_use / status_name_taken 等を個別の文言に変換する）。失敗したら取り直さない。
 */
export function useTicketMasters(workspaceSlug: string | undefined, projectId: string | undefined) {
  const queryClient = useQueryClient();
  const hasScope = workspaceSlug !== undefined && projectId !== undefined;
  const statusesResult = useQuery({ ...ticketStatusesQuery(workspaceSlug ?? '', projectId ?? ''), enabled: hasScope });
  const typesResult = useQuery({ ...ticketTypesQuery(workspaceSlug ?? '', projectId ?? ''), enabled: hasScope });

  const { refetch: refetchStatuses } = statusesResult;
  const { refetch: refetchTypes } = typesResult;
  const refresh = useCallback(() => {
    void refetchStatuses();
    void refetchTypes();
  }, [refetchStatuses, refetchTypes]);

  const requireScope = useCallback((): [string, string] => {
    if (!workspaceSlug || !projectId) throw new Error('backlog: no active scope');
    return [workspaceSlug, projectId];
  }, [workspaceSlug, projectId]);

  /** 変更を送り、成功したら状態の一覧を取り直させる（待たずに返す）。 */
  const changeStatuses = useCallback(
    async <T,>(run: (slug: string, project: string) => Promise<T>): Promise<T> => {
      const [slug, project] = requireScope();
      const result = await run(slug, project);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.statuses(slug, project) });
      return result;
    },
    [requireScope, queryClient],
  );

  /** 変更を送り、成功したら種別の一覧を取り直させる（待たずに返す）。 */
  const changeTypes = useCallback(
    async <T,>(run: (slug: string, project: string) => Promise<T>): Promise<T> => {
      const [slug, project] = requireScope();
      const result = await run(slug, project);
      void queryClient.invalidateQueries({ queryKey: ticketKeys.types(slug, project) });
      return result;
    },
    [requireScope, queryClient],
  );

  const createStatus = useCallback(
    (input: TicketStatusInput) =>
      changeStatuses((slug, project) => TicketRepository.createTicketStatus(slug, project, input)),
    [changeStatuses],
  );

  const updateStatus = useCallback(
    (statusId: string, input: TicketStatusInput) =>
      changeStatuses((slug, project) => TicketRepository.updateTicketStatus(slug, project, statusId, input)),
    [changeStatuses],
  );

  const setInitialStatus = useCallback(
    (statusId: string) =>
      changeStatuses((slug, project) => TicketRepository.setInitialTicketStatus(slug, project, statusId)),
    [changeStatuses],
  );

  const archiveStatus = useCallback(
    (statusId: string) =>
      changeStatuses((slug, project) => TicketRepository.archiveTicketStatus(slug, project, statusId)),
    [changeStatuses],
  );

  const restoreStatus = useCallback(
    (statusId: string) =>
      changeStatuses((slug, project) => TicketRepository.restoreTicketStatus(slug, project, statusId)),
    [changeStatuses],
  );

  const createType = useCallback(
    (input: TicketTypeInput) => changeTypes((slug, project) => TicketRepository.createTicketType(slug, project, input)),
    [changeTypes],
  );

  const updateType = useCallback(
    (typeId: string, input: TicketTypeInput) =>
      changeTypes((slug, project) => TicketRepository.updateTicketType(slug, project, typeId, input)),
    [changeTypes],
  );

  const setDefaultType = useCallback(
    (typeId: string) => changeTypes((slug, project) => TicketRepository.setDefaultTicketType(slug, project, typeId)),
    [changeTypes],
  );

  const archiveType = useCallback(
    (typeId: string) => changeTypes((slug, project) => TicketRepository.archiveTicketType(slug, project, typeId)),
    [changeTypes],
  );

  const restoreType = useCallback(
    (typeId: string) => changeTypes((slug, project) => TicketRepository.restoreTicketType(slug, project, typeId)),
    [changeTypes],
  );

  const statusesView = queryShownState(statusesResult, hasScope);
  const typesView = queryShownState(typesResult, hasScope);

  return {
    statuses: statusesView.data ?? NO_STATUSES,
    types: typesView.data ?? NO_TYPES,
    loading: statusesView.loading || typesView.loading,
    error: statusesView.failed || typesView.failed ? LOAD_FAILED : null,
    refresh,
    createStatus,
    updateStatus,
    setInitialStatus,
    archiveStatus,
    restoreStatus,
    createType,
    updateType,
    setDefaultType,
    archiveType,
    restoreType,
  };
}
