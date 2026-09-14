import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TicketRepository,
  type ChangeTicketStatusInput,
  type CreateTicketInput,
  type Label,
  type Ticket,
  type TicketListFilter,
  type UpdateTicketInput,
} from '@/entities/ticket';

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

interface ListTarget {
  key: string;
  workspaceSlug: string;
  projectId: string;
  filter: TicketListFilter;
}

function targetOf(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  options: UseTicketListOptions,
): ListTarget | null {
  if (!workspaceSlug || !projectId) return null;
  const filter: TicketListFilter = {
    archived: options.archived,
    statusId: options.statusId,
    typeId: options.typeId,
    assigneePrincipalId: options.assigneePrincipalId,
    labelId: options.labelId,
    unassigned: options.unassigned,
    assignedToMe: options.assignedToMe,
    overdue: options.overdue,
    q: options.q,
  };
  // 区切りは全角空白（slug にも UUID にも現れない。useKbComments と同じ理由）。
  const key = [
    workspaceSlug,
    projectId,
    options.archived ? 'arc' : 'live',
    options.statusId ?? '',
    options.typeId ?? '',
    options.assigneePrincipalId ?? '',
    options.labelId ?? '',
    options.unassigned ? 'u' : '',
    options.assignedToMe ? 'me' : '',
    options.overdue ? 'od' : '',
    options.q ?? '',
  ].join(' ');
  return { key, workspaceSlug, projectId, filter };
}

/**
 * useTicketList はプロジェクト 1 つぶんのチケット一覧を読み書きする。
 *
 * 一覧の応答は既に `Ticket` の全項目（doc 含む）を持っているため、詳細パネルは
 * 別に取得しない — 選択中の 1 件をこの配列から `find` するだけでよい
 * （履歴だけは別 hook `useTicketDetail` が持つ）。
 *
 * 宛先（workspaceSlug + projectId + 現役/アーカイブ + 絞り込み）が変わるたびに取り直す。
 * 応答は要求を始めたときの宛先が今も見えているときだけ反映し、古い応答で
 * 新しい画面を上書きしない（useKbComments と同じ 3 点確認: 宛先一致・seq 一致・
 * 取得中に割り込んだ書き込みが無いこと）。
 *
 * 楽観更新はしない（設計 Ⅳ-E）。応答をそのまま state へ入れ、失敗は投げる
 * （呼び出し側がトーストで知らせる）。
 */
export function useTicketList(
  workspaceSlug: string | undefined,
  projectId: string | undefined,
  options: UseTicketListOptions,
) {
  const [state, setState] = useState<TicketListState>({
    tickets: [],
    loading: false,
    error: null,
    busyId: null,
  });

  const active = useRef<ListTarget | null>(null);
  const seq = useRef(0);
  const writeCount = useRef(0);

  const target = targetOf(workspaceSlug, projectId, options);
  const targetKey = target?.key ?? null;

  const load = useCallback(async (to: ListTarget) => {
    const request = ++seq.current;
    const writesAtStart = writeCount.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const tickets = await TicketRepository.fetchTickets(to.workspaceSlug, to.projectId, to.filter);
      if (active.current?.key !== to.key || seq.current !== request) return;
      if (writeCount.current !== writesAtStart) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      setState({ tickets, loading: false, error: null, busyId: null });
    } catch {
      if (active.current?.key !== to.key || seq.current !== request) return;
      if (writeCount.current !== writesAtStart) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      setState({ tickets: [], loading: false, error: LOAD_FAILED, busyId: null });
    }
  }, []);

  useEffect(() => {
    active.current = target;
    if (!target) {
      seq.current += 1;
      setState({ tickets: [], loading: false, error: null, busyId: null });
      return;
    }
    void load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, load]);

  const refresh = useCallback(() => {
    if (active.current) void load(active.current);
  }, [load]);

  /**
   * mutate は 1 件への操作を行い、宛先が変わっていなければ結果を局所的に反映する
   * （useKbComments.mutate と同じ形。宛先が変わっていたら画面には触らない）。
   */
  const mutate = useCallback(
    async <T,>(
      ticketId: string,
      run: (to: ListTarget) => Promise<T>,
      apply: (prev: Ticket[], result: T) => Ticket[],
    ): Promise<T> => {
      const to = active.current;
      if (!to) throw new Error('backlog: no active target');
      const request = seq.current;
      setState((prev) => ({ ...prev, busyId: ticketId }));
      try {
        const result = await run(to);
        if (active.current?.key === to.key && seq.current === request) {
          writeCount.current += 1;
          setState((prev) => ({ ...prev, tickets: apply(prev.tickets, result), busyId: null }));
        }
        return result;
      } catch (cause) {
        if (active.current?.key === to.key && seq.current === request) {
          setState((prev) => ({ ...prev, busyId: null }));
        }
        throw cause;
      }
    },
    [],
  );

  const replaceInPlace = (tickets: Ticket[], updated: Ticket): Ticket[] =>
    tickets.map((t) => (t.id === updated.id ? updated : t));

  const removeFromList = (tickets: Ticket[], ticketId: string): Ticket[] =>
    tickets.filter((t) => t.id !== ticketId);

  const createTicket = useCallback(
    (input: CreateTicketInput) =>
      mutate(
        '',
        (to) => TicketRepository.createTicket(to.workspaceSlug, to.projectId, input),
        (tickets, created) => [...tickets, created],
      ),
    [mutate],
  );

  const updateTicket = useCallback(
    (ticketId: string, input: UpdateTicketInput) =>
      mutate(
        ticketId,
        (to) => TicketRepository.updateTicket(to.workspaceSlug, ticketId, input),
        replaceInPlace,
      ),
    [mutate],
  );

  /** アーカイブは今の視界（現役タブ）から消える。アーカイブタブ側は Restore の対称。 */
  const archiveTicket = useCallback(
    (ticketId: string) =>
      mutate(
        ticketId,
        (to) => TicketRepository.archiveTicket(to.workspaceSlug, ticketId),
        (tickets) => removeFromList(tickets, ticketId),
      ),
    [mutate],
  );

  const restoreTicket = useCallback(
    (ticketId: string) =>
      mutate(
        ticketId,
        (to) => TicketRepository.restoreTicket(to.workspaceSlug, ticketId),
        (tickets) => removeFromList(tickets, ticketId),
      ),
    [mutate],
  );

  const changeStatus = useCallback(
    (ticketId: string, input: ChangeTicketStatusInput) =>
      mutate(
        ticketId,
        (to) => TicketRepository.changeTicketStatus(to.workspaceSlug, ticketId, input),
        replaceInPlace,
      ),
    [mutate],
  );

  const changeParent = useCallback(
    (ticketId: string, parentId: string | null) =>
      mutate(
        ticketId,
        (to) => TicketRepository.changeTicketParent(to.workspaceSlug, ticketId, parentId),
        replaceInPlace,
      ),
    [mutate],
  );

  const assign = useCallback(
    (ticketId: string, assigneePrincipalId: string) =>
      mutate(
        ticketId,
        (to) => TicketRepository.assignTicket(to.workspaceSlug, ticketId, assigneePrincipalId),
        (tickets) =>
          tickets.map((t) => (t.id === ticketId ? { ...t, assigneePrincipalId } : t)),
      ),
    [mutate],
  );

  const unassign = useCallback(
    (ticketId: string) =>
      mutate(
        ticketId,
        (to) => TicketRepository.unassignTicket(to.workspaceSlug, ticketId),
        (tickets) => tickets.map((t) => (t.id === ticketId ? { ...t, assigneePrincipalId: null } : t)),
      ),
    [mutate],
  );

  /** 並び替えは新しい順位が応答に無いので一覧を取り直す（設計 Ⅶ）。 */
  const move = useCallback(
    async (ticketId: string, input: { anchorTicketId?: string; anchorAfter?: boolean }) => {
      const to = active.current;
      if (!to) return;
      setState((prev) => ({ ...prev, busyId: ticketId }));
      try {
        await TicketRepository.moveTicket(to.workspaceSlug, ticketId, input);
      } finally {
        setState((prev) => ({ ...prev, busyId: null }));
      }
      if (active.current?.key === to.key) {
        refresh();
      }
    },
    [refresh],
  );

  const addLabel = useCallback(
    (ticketId: string, label: Label) =>
      mutate(
        ticketId,
        (to) => TicketRepository.addTicketLabel(to.workspaceSlug, ticketId, label.id),
        (tickets) =>
          tickets.map((t) =>
            t.id === ticketId && !t.labels.some((l) => l.id === label.id)
              ? { ...t, labels: [...t.labels, label] }
              : t,
          ),
      ),
    [mutate],
  );

  const removeLabel = useCallback(
    (ticketId: string, labelId: string) =>
      mutate(
        ticketId,
        (to) => TicketRepository.removeTicketLabel(to.workspaceSlug, ticketId, labelId),
        (tickets) =>
          tickets.map((t) => (t.id === ticketId ? { ...t, labels: t.labels.filter((l) => l.id !== labelId) } : t)),
      ),
    [mutate],
  );

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
