import { useCallback, useEffect, useRef, useState } from 'react';
import { TicketRepository, type TicketComment, type TicketCommentBlock } from '@/entities/ticket';

export interface TicketCommentsState {
  comments: TicketComment[];
  loading: boolean;
  error: string | null;
}

const LOAD_FAILED = 'コメントを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';

interface Target {
  key: string;
  workspaceSlug: string;
  ticketId: string;
}

/**
 * useTicketComments はチケット 1 件ぶんの発言を読み書きする（useTicketList・useKbComments と
 * 同じ形: 宛先一致・世代一致・取得中に割り込んだ書き込みが無いことの 3 点確認で、
 * 遅れて返ってきた前の宛先の応答が今の画面を上書きしないようにする）。
 *
 * 楽観更新はしない。応答をそのまま state へ入れ、失敗は投げる（呼び出し側が知らせる）。
 *
 * **編集の応答は反応を運ばない**（backend が常に空配列で返す）。素直に差し替えると
 * 画面上の反応が消えるので、`editComment` は本文・edited・updatedAt だけを差し替え、
 * reactions は手元の値を残す。
 */
export function useTicketComments(workspaceSlug: string | undefined, ticketId: string | undefined) {
  const [state, setState] = useState<TicketCommentsState>({ comments: [], loading: false, error: null });
  const active = useRef<Target | null>(null);
  const seq = useRef(0);
  const writeCount = useRef(0);

  const target: Target | null =
    workspaceSlug && ticketId ? { key: `${workspaceSlug} ${ticketId}`, workspaceSlug, ticketId } : null;
  const targetKey = target?.key ?? null;

  const load = useCallback(async (to: Target) => {
    const request = ++seq.current;
    const writesAtStart = writeCount.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const comments = await TicketRepository.fetchTicketComments(to.workspaceSlug, to.ticketId);
      if (active.current?.key !== to.key || seq.current !== request) return;
      if (writeCount.current !== writesAtStart) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      setState({ comments, loading: false, error: null });
    } catch {
      if (active.current?.key !== to.key || seq.current !== request) return;
      if (writeCount.current !== writesAtStart) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      setState({ comments: [], loading: false, error: LOAD_FAILED });
    }
  }, []);

  useEffect(() => {
    active.current = target;
    if (!target) {
      seq.current += 1;
      setState({ comments: [], loading: false, error: null });
      return;
    }
    void load(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, load]);

  const refresh = useCallback(() => {
    if (active.current) void load(active.current);
  }, [load]);

  /**
   * 書き込みの応答を、書き込みを始めたときと同じ閲覧のままなら反映する。
   *
   * **宛先（key）の一致だけでは足りない** — 閉じてすぐ同じチケットを開き直すと key は同じだが、
   * それは別の閲覧で、開き直しの取得に書き込みの結果がもう入っていることがある。始めたときの
   * seq も確かめ、開き直しのあとに前の応答を重ねない（発言が二重に増える。useKbComments と同じ）。
   *
   * 同じチケットのまま書き込み中に取り直し（refresh・開き直し）が挟まったときは、その取得に
   * 書き込みの結果が入っているかどうか手元では分からない（backend が書き終える前に読んだかもしれない）。
   * 応答を重ねも捨てもせず、もう一度取り直して backend の今の一覧に合わせる。
   */
  const applyIfCurrent = useCallback(
    (to: Target, request: number, apply: (comments: TicketComment[]) => TicketComment[]) => {
      if (active.current?.key !== to.key) return;
      if (seq.current !== request) {
        void load(active.current);
        return;
      }
      writeCount.current += 1;
      setState((prev) => ({ ...prev, comments: apply(prev.comments) }));
    },
    [load],
  );

  const createComment = useCallback(
    async (body: TicketCommentBlock[], parentCommentId?: string) => {
      const to = active.current;
      if (!to) throw new Error('ticket comments: no active target');
      const request = seq.current;
      const created = await TicketRepository.createTicketComment(to.workspaceSlug, to.ticketId, body, parentCommentId);
      applyIfCurrent(to, request, (comments) => [...comments, created]);
      return created;
    },
    [applyIfCurrent],
  );

  const editComment = useCallback(
    async (commentId: string, body: TicketCommentBlock[]) => {
      const to = active.current;
      if (!to) throw new Error('ticket comments: no active target');
      const request = seq.current;
      const updated = await TicketRepository.updateTicketComment(to.workspaceSlug, to.ticketId, commentId, body);
      applyIfCurrent(to, request, (comments) =>
        comments.map((c) =>
          c.id === commentId
            ? { ...c, body: updated.body, edited: updated.edited, updatedAt: updated.updatedAt }
            : c,
        ),
      );
    },
    [applyIfCurrent],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      const to = active.current;
      if (!to) throw new Error('ticket comments: no active target');
      const request = seq.current;
      await TicketRepository.deleteTicketComment(to.workspaceSlug, to.ticketId, commentId);
      applyIfCurrent(to, request, (comments) => comments.filter((c) => c.id !== commentId));
    },
    [applyIfCurrent],
  );

  /** 204 で本体が返らないので、成功を受けてから手元の反応を足す。 */
  const addReaction = useCallback(
    async (commentId: string, emoji: string, userId: number) => {
      const to = active.current;
      if (!to) throw new Error('ticket comments: no active target');
      const request = seq.current;
      await TicketRepository.addTicketCommentReaction(to.workspaceSlug, to.ticketId, commentId, emoji);
      applyIfCurrent(to, request, (comments) =>
        comments.map((c) =>
          c.id === commentId
            ? c.reactions.some((r) => r.userId === userId && r.emoji === emoji)
              ? c
              : { ...c, reactions: [...c.reactions, { userId, emoji }] }
            : c,
        ),
      );
    },
    [applyIfCurrent],
  );

  /** 204 で本体が返らないので、成功を受けてから手元の反応を外す。 */
  const removeReaction = useCallback(
    async (commentId: string, emoji: string, userId: number) => {
      const to = active.current;
      if (!to) throw new Error('ticket comments: no active target');
      const request = seq.current;
      await TicketRepository.removeTicketCommentReaction(to.workspaceSlug, to.ticketId, commentId, emoji);
      applyIfCurrent(to, request, (comments) =>
        comments.map((c) =>
          c.id === commentId
            ? { ...c, reactions: c.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji)) }
            : c,
        ),
      );
    },
    [applyIfCurrent],
  );

  return { ...state, refresh, createComment, editComment, deleteComment, addReaction, removeReaction };
}
