import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { getApiError } from '@/shared/lib/classifyApiError';
import {
  TicketRepository,
  resolvedTicketQuery,
  type ChangeTicketStatusInput,
  type Label,
  type Ticket,
  type UpdateTicketInput,
} from '@/entities/ticket';
import { projectQuery } from '@/entities/project';
import { reflectTicket, refreshTicketAncestry, refreshTicketDerived } from '@/features/ticket-cache';

const NO_ANCESTORS: Ticket[] = [];

const NOT_FOUND = 'チケットが見つかりませんでした。';
const LOAD_FAILED = 'チケットを開けませんでした。時間をおいて開き直すと最新の状態が出ます。';

/**
 * useTicketPage はチケット 1 件を、ワークスペースを URL に持たない口から解決して持つ。
 *
 * 通知・本文中の参照・ブックマークからの再訪はワークスペースを知らないまま来るので、
 * ID だけで開ける必要がある。応答の workspaceSlug を以降の書き込みに使う。
 *
 * プロジェクトを別に引くのは**表示キー（例 FRESTYLE-12）に projects.key が要る**ため。
 * チケットの応答には projectId しか入っておらず、key は入っていない。
 *
 * 解決した 1 件は共有の問い合わせ（resolvedTicketQuery）から読む。チケットごとの鍵なので、
 * 遅れて返ってきた前のチケットの応答が今の画面に混ざらない。楽観更新はしない。書き込みの応答を
 * この 1 件とバックログの一覧の控えの両方へ映し（reflectTicket）、件数などの派生を古いものにする。
 * 失敗は投げる（呼び出し側が知らせる）。
 */
export function useTicketPage(ticketId: string | undefined) {
  const queryClient = useQueryClient();
  const active = ticketId !== undefined;
  const resolvedResult = useQuery({ ...resolvedTicketQuery(ticketId ?? ''), enabled: active });
  const shown = queryShownState(resolvedResult, active);
  const resolved = shown.data;
  const workspaceSlug = resolved?.workspaceSlug ?? null;
  const projectId = resolved?.ticket.projectId ?? null;

  // プロジェクトは表示キーのためだけに引く。引けなくてもチケットは出す（キーが出ないだけ）。
  // 取れるか失敗するかが決まるまでは読み込み中にする（キーがあとから出ると見出しがずれる）。
  const projectResult = useQuery({
    ...projectQuery(workspaceSlug ?? '', projectId ?? ''),
    enabled: workspaceSlug !== null && projectId !== null,
  });
  const projectSettling = resolved !== undefined && projectResult.isPending && projectResult.isFetching;

  // 書き込みが飛んでいる間は、どのチケットへの書き込みかと組で持つ（別のチケットへ移ったら出さない）。
  const [busyFor, setBusyFor] = useState<string | null>(null);

  const { refetch } = resolvedResult;
  const { refetch: refetchProject, isError: projectFailed } = projectResult;
  const refresh = useCallback(() => {
    if (!active) return;
    void refetch();
    if (projectFailed) void refetchProject();
  }, [active, refetch, projectFailed, refetchProject]);

  /** 1 件への書き込み。応答をこの 1 件と一覧の控えへ映し、派生を古いものにする。 */
  const mutate = useCallback(
    async <T,>(
      run: (slug: string, id: string) => Promise<T>,
      updated: (result: T) => (ticket: Ticket) => Ticket,
    ): Promise<T> => {
      if (!ticketId || !workspaceSlug || !projectId) throw new Error('ticket page: not resolved');
      const id = ticketId;
      const slug = workspaceSlug;
      const project = projectId;
      setBusyFor(id);
      try {
        const result = await run(slug, id);
        await reflectTicket(queryClient, slug, project, id, updated(result));
        refreshTicketDerived(queryClient, slug, project);
        return result;
      } finally {
        setBusyFor((prev) => (prev === id ? null : prev));
      }
    },
    [ticketId, workspaceSlug, projectId, queryClient],
  );

  const updateTicket = useCallback(
    (input: UpdateTicketInput) =>
      mutate((slug, id) => TicketRepository.updateTicket(slug, id, input), (written) => () => written),
    [mutate],
  );

  const changeStatus = useCallback(
    (input: ChangeTicketStatusInput) =>
      mutate((slug, id) => TicketRepository.changeTicketStatus(slug, id, input), (written) => () => written),
    [mutate],
  );

  const assign = useCallback(
    (assigneePrincipalId: string) =>
      mutate(
        (slug, id) => TicketRepository.assignTicket(slug, id, assigneePrincipalId),
        () => (t) => ({ ...t, assigneePrincipalId }),
      ),
    [mutate],
  );

  /** 204 応答（本体が返らない）ので手元で外す。 */
  const unassign = useCallback(
    () =>
      mutate(
        (slug, id) => TicketRepository.unassignTicket(slug, id),
        () => (t) => ({ ...t, assigneePrincipalId: null }),
      ),
    [mutate],
  );

  const archive = useCallback(
    () => mutate((slug, id) => TicketRepository.archiveTicket(slug, id), (written) => () => written),
    [mutate],
  );

  const restore = useCallback(
    () => mutate((slug, id) => TicketRepository.restoreTicket(slug, id), (written) => () => written),
    [mutate],
  );

  const addLabel = useCallback(
    (label: Label) =>
      mutate(
        (slug, id) => TicketRepository.addTicketLabel(slug, id, label.id),
        () => (t) => (t.labels.some((l) => l.id === label.id) ? t : { ...t, labels: [...t.labels, label] }),
      ),
    [mutate],
  );

  const removeLabel = useCallback(
    (labelId: string) =>
      mutate(
        (slug, id) => TicketRepository.removeTicketLabel(slug, id, labelId),
        () => (t) => ({ ...t, labels: t.labels.filter((l) => l.id !== labelId) }),
      ),
    [mutate],
  );

  /**
   * 親を変える。祖先の列（パンくず）は応答に入っていないので、応答を映したうえで解決した 1 件を
   * 取り直す（取り直しの間も今の画面は出したまま）。
   */
  const changeParent = useCallback(
    async (parentId: string | null) => {
      await mutate((slug, id) => TicketRepository.changeTicketParent(slug, id, parentId), (written) => () => written);
      await refreshTicketAncestry(queryClient);
    },
    [mutate, queryClient],
  );

  const status = shown.failed ? getApiError(resolvedResult.error).status : undefined;

  return {
    /** 以降の API 呼び出しに使う。解決するまで null。 */
    workspaceSlug,
    ticket: resolved?.ticket ?? null,
    /** 根から順の祖先（自分自身は含まない）。 */
    ancestors: resolved?.ancestors ?? NO_ANCESTORS,
    permission: resolved?.permission ?? null,
    /** 表示キーの組み立てとバックログへ戻る導線に要る。引けなければ null（キーが出ないだけ）。 */
    project: resolved ? (projectResult.data ?? null) : null,
    loading: shown.loading || projectSettling,
    error: shown.failed ? (status === 404 ? NOT_FOUND : LOAD_FAILED) : null,
    /** この 1 件への書き込みが飛んでいる間 true。 */
    busy: active && busyFor === ticketId,
    refresh,
    updateTicket,
    changeStatus,
    assign,
    unassign,
    archive,
    restore,
    addLabel,
    removeLabel,
    changeParent,
  };
}
