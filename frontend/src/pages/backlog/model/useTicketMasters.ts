import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TicketRepository,
  type TicketStatus,
  type TicketStatusInput,
  type TicketType,
  type TicketTypeInput,
} from '@/entities/ticket';

const LOAD_FAILED = 'マスタを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';

/**
 * useTicketMasters はプロジェクトの状態・種別マスタ（一覧・管理操作）を読み書きする。
 *
 * 状態/種別の変更はすべて **一覧を取り直す**（設計 Ⅶ）。個々の応答（Create/Update は
 * activeTicketCount を持たない・SetInitial 等は 204）を局所的に反映しようとすると
 * 使用中件数が食い違うため、マスタに限っては「変更のたびに引き直す」の一択にしてある。
 *
 * 失敗はすべて例外として投げる（呼び出し側 TicketStatusAdmin / TicketTypeAdmin が
 * status_in_use / status_name_taken 等を個別の文言に変換する）。
 */
export function useTicketMasters(workspaceSlug: string | undefined, projectId: string | undefined) {
  const [statuses, setStatuses] = useState<TicketStatus[]>([]);
  const [types, setTypes] = useState<TicketType[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const active = useRef<string | null>(null);

  const load = useCallback(async (slug: string, project: string) => {
    const key = `${slug} ${project}`;
    setLoading(true);
    setError(null);
    try {
      const [statusList, typeList] = await Promise.all([
        TicketRepository.fetchTicketStatuses(slug, project),
        TicketRepository.fetchTicketTypes(slug, project),
      ]);
      if (active.current !== key) return;
      setStatuses(statusList);
      setTypes(typeList);
    } catch {
      if (active.current !== key) return;
      setError(LOAD_FAILED);
    } finally {
      if (active.current === key) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const key = workspaceSlug && projectId ? `${workspaceSlug} ${projectId}` : null;
    active.current = key;
    if (!workspaceSlug || !projectId) {
      setStatuses([]);
      setTypes([]);
      return;
    }
    void load(workspaceSlug, projectId);
  }, [workspaceSlug, projectId, load]);

  const refresh = useCallback(() => {
    if (workspaceSlug && projectId) void load(workspaceSlug, projectId);
  }, [workspaceSlug, projectId, load]);

  const withRefresh = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      const result = await run();
      refresh();
      return result;
    },
    [refresh],
  );

  const requireScope = useCallback((): [string, string] => {
    if (!workspaceSlug || !projectId) throw new Error('backlog: no active scope');
    return [workspaceSlug, projectId];
  }, [workspaceSlug, projectId]);

  const createStatus = useCallback(
    (input: TicketStatusInput) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.createTicketStatus(slug, project, input));
    },
    [withRefresh, requireScope],
  );

  const updateStatus = useCallback(
    (statusId: string, input: TicketStatusInput) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.updateTicketStatus(slug, project, statusId, input));
    },
    [withRefresh, requireScope],
  );

  const setInitialStatus = useCallback(
    (statusId: string) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.setInitialTicketStatus(slug, project, statusId));
    },
    [withRefresh, requireScope],
  );

  const archiveStatus = useCallback(
    (statusId: string) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.archiveTicketStatus(slug, project, statusId));
    },
    [withRefresh, requireScope],
  );

  const restoreStatus = useCallback(
    (statusId: string) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.restoreTicketStatus(slug, project, statusId));
    },
    [withRefresh, requireScope],
  );

  const createType = useCallback(
    (input: TicketTypeInput) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.createTicketType(slug, project, input));
    },
    [withRefresh, requireScope],
  );

  const updateType = useCallback(
    (typeId: string, input: TicketTypeInput) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.updateTicketType(slug, project, typeId, input));
    },
    [withRefresh, requireScope],
  );

  const setDefaultType = useCallback(
    (typeId: string) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.setDefaultTicketType(slug, project, typeId));
    },
    [withRefresh, requireScope],
  );

  const archiveType = useCallback(
    (typeId: string) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.archiveTicketType(slug, project, typeId));
    },
    [withRefresh, requireScope],
  );

  const restoreType = useCallback(
    (typeId: string) => {
      const [slug, project] = requireScope();
      return withRefresh(() => TicketRepository.restoreTicketType(slug, project, typeId));
    },
    [withRefresh, requireScope],
  );

  return {
    statuses,
    types,
    loading,
    error,
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
