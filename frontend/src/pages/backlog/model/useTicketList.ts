import { useCallback, useMemo, useState } from 'react';
import { partialMatchKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { queryShownState } from '@/shared/api/queryState';
import {
  TicketRepository,
  ticketKeys,
  ticketListQuery,
  type ChangeTicketStatusInput,
  type CreateTicketInput,
  type Label,
  type Ticket,
  type TicketListFilter,
  type UpdateTicketInput,
} from '@/entities/ticket';
import { reflectTicket, refreshTicketAncestry, refreshTicketDerived } from '@/features/ticket-cache';
import { reuseUnchanged } from '../lib/reuseUnchanged';

export interface UseTicketListOptions {
  /** true でアーカイブ済みだけを見る（現役との「込み」は取れない。設計 Ⅳ-C）。 */
  archived: boolean;
  statusId?: string;
  typeId?: string;
  assigneePrincipalId?: string;
  labelId?: string;
  unassigned?: boolean;
  assignedToMe?: boolean;
  overdue?: boolean;
  q?: string;
}

export interface TicketListState {
  tickets: Ticket[];
  loading: boolean;
  error: string | null;
  /** 一覧に載る 1 件への操作（並び替え・状態変更等）が飛んでいる間、その ticketId。 */
  busyId: string | null;
}

const LOAD_FAILED = 'チケットを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';
const NO_TICKETS: Ticket[] = [];

/**
 * 絞り込みの条件。条件の無い項目は入れない（鍵が同じ条件で揃うように）。現役（archived が偽）も
 * 条件の無い側 — 送る問い合わせが同じなので、親を選ぶ候補（条件なし）と同じ控えを使う。
 */
function filterOf(options: UseTicketListOptions): TicketListFilter {
  const filter: TicketListFilter = {};
  if (options.archived) filter.archived = true;
  if (options.statusId) filter.statusId = options.statusId;
  if (options.typeId) filter.typeId = options.typeId;
  if (options.assigneePrincipalId) filter.assigneePrincipalId = options.assigneePrincipalId;
  if (options.labelId) filter.labelId = options.labelId;
  if (options.unassigned) filter.unassigned = true;
  if (options.assignedToMe) filter.assignedToMe = true;
  if (options.overdue) filter.overdue = true;
  if (options.q) filter.q = options.q;
  return filter;
}

/**
 * useTicketList はプロジェクト 1 つぶんのチケット一覧を読み書きする。
 *
 * 一覧の応答は既に `Ticket` の全項目（doc 含む）を持っているため、詳細パネルは
 * 別に取得しない — 選択中の 1 件をこの配列から `find` するだけでよい
 * （履歴だけは別 hook `useTicketDetail` が持つ）。
 *
 * 一覧は絞り込みごとの共有の問い合わせ（ticketListQuery）から読む。宛先（workspaceSlug +
 * projectId + 現役/アーカイブ + 絞り込み）ごとの鍵なので、古い宛先の応答で新しい画面を上書き
 * しない。同じプロジェクトの中で絞り込みを変えたら、取り終えるまで前の一覧を出したまま
 * `loading`（「更新中」）を立てる — 消して読み込み表示にすると、押した行がその瞬間だけ消えて
 * 選び直すことになる。中身の変わらないチケットは前に出していた値を使う（reuseUnchanged）ので、
 * 絞り込みの 1 文字・取り直しでは変わった行だけが描き直る。
 *
 * 楽観更新はしない（設計 Ⅳ-E）。書き込みの応答で、書いた時点の一覧を直し（reflectWrite）、
 * そのチケットを載せているほかの一覧とチケットの画面にも新しい値を映す（reflectTicket）。
 * 件数・保存した絞り込み・状態の使用中の件数・担当の一覧などの派生は古いものにする
 * （refreshTicketDerived）。失敗は投げる（呼び出し側がトーストで知らせる）。
 */
export function useTicketList(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  options: UseTicketListOptions,
) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined && projectId !== undefined;
  const { archived, statusId, typeId, assigneePrincipalId, labelId, unassigned, assignedToMe, overdue, q } = options;
  // 絞り込みは項目ごとに見て控える（描くたびに新しい物を作ると、鍵を使う操作の関数が毎回作り直される）。
  const listQuery = useMemo(
    () =>
      ticketListQuery(
        workspaceSlug ?? '',
        projectId ?? '',
        filterOf({ archived, statusId, typeId, assigneePrincipalId, labelId, unassigned, assignedToMe, overdue, q }),
      ),
    [workspaceSlug, projectId, archived, statusId, typeId, assigneePrincipalId, labelId, unassigned, assignedToMe, overdue, q],
  );
  const result = useQuery({
    ...listQuery,
    enabled: active,
    // 同じプロジェクトの一覧（絞り込みだけが違う）なら、取り終えるまでそれを出しておく。
    // プロジェクトを移ったら、前のプロジェクトのチケットは出さない。
    placeholderData: (previous, previousQuery) =>
      previousQuery && partialMatchKey(previousQuery.queryKey, ticketKeys.lists(workspaceSlug ?? '', projectId ?? ''))
        ? previous
        : undefined,
  });
  const shown = queryShownState(result, active);
  const [busyId, setBusyId] = useState<string | null>(null);

  // 置き場が変わらない部分を使い回すのは同じ鍵の中だけなので、絞り込みを変えて鍵が移ったときは
  // ここで前に出していた値に揃える（行は memo で、同じ値なら描き直さない）。描いている途中で
  // 揃える（effect で揃えると、揃える前の値で全行を 1 回描いてしまう）。
  const [shownList, setShownList] = useState<{ source: Ticket[] | undefined; tickets: Ticket[] }>({
    source: undefined,
    tickets: NO_TICKETS,
  });
  if (shownList.source !== shown.data) {
    setShownList({
      source: shown.data,
      tickets: shown.data === undefined ? NO_TICKETS : reuseUnchanged(shownList.tickets, shown.data),
    });
  }

  const { refetch } = result;
  const refresh = useCallback(() => {
    if (active) void refetch();
  }, [active, refetch]);

  // 書いた時点の一覧の鍵。書いている間に絞り込みを変えても、書いた一覧を直す。
  const currentKey = listQuery.queryKey;

  /**
   * mutate は 1 件への操作を行い、書いた時点の一覧を応答で直す。そのチケットを載せている
   * ほかの控えにも新しい値を映し（見つかれば）、派生を古いものにする。
   */
  const mutate = useCallback(
    async <T,>(
      ticketId: string,
      run: (slug: string, project: string) => Promise<T>,
      apply: (prev: Ticket[], result: T) => Ticket[],
      updated?: (result: T) => ((ticket: Ticket) => Ticket) | null,
    ): Promise<T> => {
      if (!workspaceSlug || !projectId) throw new Error('backlog: no active target');
      const slug = workspaceSlug;
      const project = projectId;
      setBusyId(ticketId);
      try {
        const written = await run(slug, project);
        await reflectWrite(queryClient, currentKey, (prev) => apply(prev, written));
        const update = updated?.(written) ?? null;
        if (update) await reflectTicket(queryClient, slug, project, ticketId, update);
        refreshTicketDerived(queryClient, slug, project);
        return written;
      } finally {
        setBusyId((prev) => (prev === ticketId ? null : prev));
      }
    },
    [workspaceSlug, projectId, currentKey, queryClient],
  );

  const replaceInPlace = (tickets: Ticket[], replacement: Ticket): Ticket[] =>
    tickets.map((t) => (t.id === replacement.id ? replacement : t));

  const removeFromList = (tickets: Ticket[], ticketId: string): Ticket[] =>
    tickets.filter((t) => t.id !== ticketId);

  const createTicket = useCallback(
    (input: CreateTicketInput) =>
      mutate(
        '',
        (slug, project) => TicketRepository.createTicket(slug, project, input),
        (tickets, created) => (tickets.some((t) => t.id === created.id) ? tickets : [...tickets, created]),
      ),
    [mutate],
  );

  const updateTicket = useCallback(
    (ticketId: string, input: UpdateTicketInput) =>
      mutate(
        ticketId,
        (slug) => TicketRepository.updateTicket(slug, ticketId, input),
        replaceInPlace,
        (replacement) => () => replacement,
      ),
    [mutate],
  );

  /** アーカイブは今の視界（現役タブ）から消える。アーカイブタブ側は Restore の対称。 */
  const archiveTicket = useCallback(
    (ticketId: string) =>
      mutate(
        ticketId,
        (slug) => TicketRepository.archiveTicket(slug, ticketId),
        (tickets) => removeFromList(tickets, ticketId),
        (replacement) => () => replacement,
      ),
    [mutate],
  );

  const restoreTicket = useCallback(
    (ticketId: string) =>
      mutate(
        ticketId,
        (slug) => TicketRepository.restoreTicket(slug, ticketId),
        (tickets) => removeFromList(tickets, ticketId),
        (replacement) => () => replacement,
      ),
    [mutate],
  );

  const changeStatus = useCallback(
    (ticketId: string, input: ChangeTicketStatusInput) =>
      mutate(
        ticketId,
        (slug) => TicketRepository.changeTicketStatus(slug, ticketId, input),
        replaceInPlace,
        (replacement) => () => replacement,
      ),
    [mutate],
  );

  // 親を変えると、そのチケットと子孫の祖先の列（チケットの画面のパンくず）も変わる。
  const changeParent = useCallback(
    async (ticketId: string, parentId: string | null) => {
      const written = await mutate(
        ticketId,
        (slug) => TicketRepository.changeTicketParent(slug, ticketId, parentId),
        replaceInPlace,
        (replacement) => () => replacement,
      );
      void refreshTicketAncestry(queryClient);
      return written;
    },
    [mutate, queryClient],
  );

  const assign = useCallback(
    (ticketId: string, assigneePrincipalId: string) =>
      mutate(
        ticketId,
        (slug) => TicketRepository.assignTicket(slug, ticketId, assigneePrincipalId),
        (tickets) => tickets.map((t) => (t.id === ticketId ? { ...t, assigneePrincipalId } : t)),
        () => (t) => ({ ...t, assigneePrincipalId }),
      ),
    [mutate],
  );

  const unassign = useCallback(
    (ticketId: string) =>
      mutate(
        ticketId,
        (slug) => TicketRepository.unassignTicket(slug, ticketId),
        (tickets) => tickets.map((t) => (t.id === ticketId ? { ...t, assigneePrincipalId: null } : t)),
        () => (t) => ({ ...t, assigneePrincipalId: null }),
      ),
    [mutate],
  );

  /** 並び替えは新しい順位が応答に無いので一覧を取り直す（設計 Ⅶ）。取り直しを待ってから返す。 */
  const move = useCallback(
    async (ticketId: string, input: { anchorTicketId?: string; anchorAfter?: boolean }) => {
      if (!workspaceSlug) return;
      setBusyId(ticketId);
      try {
        await TicketRepository.moveTicket(workspaceSlug, ticketId, input);
      } finally {
        setBusyId((prev) => (prev === ticketId ? null : prev));
      }
      await queryClient.invalidateQueries({ queryKey: currentKey, exact: true });
    },
    [workspaceSlug, currentKey, queryClient],
  );

  const addLabel = useCallback(
    (ticketId: string, label: Label) => {
      const add = (t: Ticket): Ticket =>
        t.labels.some((l) => l.id === label.id) ? t : { ...t, labels: [...t.labels, label] };
      return mutate(
        ticketId,
        (slug) => TicketRepository.addTicketLabel(slug, ticketId, label.id),
        (tickets) => tickets.map((t) => (t.id === ticketId ? add(t) : t)),
        () => add,
      );
    },
    [mutate],
  );

  const removeLabel = useCallback(
    (ticketId: string, labelId: string) => {
      const remove = (t: Ticket): Ticket => ({ ...t, labels: t.labels.filter((l) => l.id !== labelId) });
      return mutate(
        ticketId,
        (slug) => TicketRepository.removeTicketLabel(slug, ticketId, labelId),
        (tickets) => tickets.map((t) => (t.id === ticketId ? remove(t) : t)),
        () => remove,
      );
    },
    [mutate],
  );

  const state: TicketListState = {
    tickets: shownList.tickets,
    // 前の一覧を出したままの取り直しも「更新中」として知らせる。
    loading: active && (shown.loading || result.isFetching),
    error: shown.failed ? LOAD_FAILED : null,
    busyId,
  };
  return {
    ...state,
    refresh,
    createTicket,
    updateTicket,
    archiveTicket,
    restoreTicket,
    changeStatus,
    changeParent,
    assign,
    unassign,
    move,
    addLabel,
    removeLabel,
  };
}
