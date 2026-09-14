import { useCallback, useEffect, useRef, useState } from 'react';
import {
  TicketRepository,
  type ChangeTicketStatusInput,
  type Label,
  type Ticket,
  type TicketPermission,
  type UpdateTicketInput,
} from '@/entities/ticket';
import { ProjectRepository, type Project } from '@/entities/project';

export interface TicketPageState {
  /** 以降の API 呼び出しに使う。解決するまで null。 */
  workspaceSlug: string | null;
  ticket: Ticket | null;
  /** 根から順の祖先（自分自身は含まない）。 */
  ancestors: Ticket[];
  permission: TicketPermission | null;
  /** 表示キーの組み立てとバックログへ戻る導線に要る。 */
  project: Project | null;
  loading: boolean;
  error: string | null;
  /** この 1 件への書き込みが飛んでいる間 true。 */
  busy: boolean;
}

const EMPTY: TicketPageState = {
  workspaceSlug: null,
  ticket: null,
  ancestors: [],
  permission: null,
  project: null,
  loading: false,
  error: null,
  busy: false,
};

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
 * 楽観更新はしない。応答をそのまま state へ入れ、失敗は投げる（呼び出し側が知らせる）。
 * 遅れて返ってきた前のチケットの応答で今の画面を上書きしないよう、宛先と世代を確かめる。
 */
export function useTicketPage(ticketId: string | undefined) {
  const [state, setState] = useState<TicketPageState>(EMPTY);
  const active = useRef<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (id: string) => {
    const request = ++seq.current;
    setState({ ...EMPTY, loading: true });
    try {
      const resolved = await TicketRepository.resolveTicket(id);
      if (active.current !== id || seq.current !== request) return;
      // プロジェクトは表示キーのためだけに引く。引けなくてもチケットは出す（キーが出ないだけ）。
      let project: Project | null = null;
      try {
        project = await ProjectRepository.fetchProject(resolved.workspaceSlug, resolved.ticket.projectId);
      } catch {
        project = null;
      }
      if (active.current !== id || seq.current !== request) return;
      setState({
        workspaceSlug: resolved.workspaceSlug,
        ticket: resolved.ticket,
        ancestors: resolved.ancestors,
        permission: resolved.permission,
        project,
        loading: false,
        error: null,
        busy: false,
      });
    } catch (cause) {
      if (active.current !== id || seq.current !== request) return;
      const status = (cause as { response?: { status?: number } })?.response?.status;
      setState({ ...EMPTY, error: status === 404 ? NOT_FOUND : LOAD_FAILED });
    }
  }, []);

  useEffect(() => {
    active.current = ticketId ?? null;
    if (!ticketId) {
      seq.current += 1;
      setState(EMPTY);
      return;
    }
    void load(ticketId);
  }, [ticketId, load]);

  const refresh = useCallback(() => {
    if (active.current) void load(active.current);
  }, [load]);

  /** 1 件への書き込み。宛先が変わっていなければ結果を反映する。 */
  const mutate = useCallback(
    async <T,>(
      run: (slug: string, id: string) => Promise<T>,
      apply: (prev: Ticket, result: T) => Ticket,
    ): Promise<T> => {
      const id = active.current;
      const slug = state.workspaceSlug;
      if (!id || !slug) throw new Error('ticket page: not resolved');
      const request = seq.current;
      setState((prev) => ({ ...prev, busy: true }));
      try {
        const result = await run(slug, id);
        if (active.current === id && seq.current === request) {
          setState((prev) => (prev.ticket ? { ...prev, ticket: apply(prev.ticket, result), busy: false } : prev));
        }
        return result;
      } catch (cause) {
        if (active.current === id && seq.current === request) {
          setState((prev) => ({ ...prev, busy: false }));
        }
        throw cause;
      }
    },
    [state.workspaceSlug],
  );

  const updateTicket = useCallback(
    (input: UpdateTicketInput) =>
      mutate((slug, id) => TicketRepository.updateTicket(slug, id, input), (_prev, updated) => updated),
    [mutate],
  );

  const changeStatus = useCallback(
    (input: ChangeTicketStatusInput) =>
      mutate((slug, id) => TicketRepository.changeTicketStatus(slug, id, input), (_prev, updated) => updated),
    [mutate],
  );

  const assign = useCallback(
    (assigneePrincipalId: string) =>
      mutate(
        (slug, id) => TicketRepository.assignTicket(slug, id, assigneePrincipalId),
        (prev) => ({ ...prev, assigneePrincipalId }),
      ),
    [mutate],
  );

  /** 204 応答（本体が返らない）ので手元で外す。 */
  const unassign = useCallback(
    () =>
      mutate(
        (slug, id) => TicketRepository.unassignTicket(slug, id),
        (prev) => ({ ...prev, assigneePrincipalId: null }),
      ),
    [mutate],
  );

  const archive = useCallback(
    () => mutate((slug, id) => TicketRepository.archiveTicket(slug, id), (_prev, updated) => updated),
    [mutate],
  );

  const restore = useCallback(
    () => mutate((slug, id) => TicketRepository.restoreTicket(slug, id), (_prev, updated) => updated),
    [mutate],
  );

  const addLabel = useCallback(
    (label: Label) =>
      mutate(
        (slug, id) => TicketRepository.addTicketLabel(slug, id, label.id),
        (prev) => (prev.labels.some((l) => l.id === label.id) ? prev : { ...prev, labels: [...prev.labels, label] }),
      ),
    [mutate],
  );

  const removeLabel = useCallback(
    (labelId: string) =>
      mutate(
        (slug, id) => TicketRepository.removeTicketLabel(slug, id, labelId),
        (prev) => ({ ...prev, labels: prev.labels.filter((l) => l.id !== labelId) }),
      ),
    [mutate],
  );

  /**
   * 親を変える。祖先列（パンくず）も変わるので、`ticket` だけ差し替える mutate では
   * 済まず取り直す（useTicketList.move と同じ理由）。
   */
  const changeParent = useCallback(
    async (parentId: string | null) => {
      const id = active.current;
      const slug = state.workspaceSlug;
      if (!id || !slug) throw new Error('ticket page: not resolved');
      setState((prev) => ({ ...prev, busy: true }));
      try {
        await TicketRepository.changeTicketParent(slug, id, parentId);
      } finally {
        setState((prev) => ({ ...prev, busy: false }));
      }
      if (active.current === id) refresh();
    },
    [state.workspaceSlug, refresh],
  );

  return {
    ...state,
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
