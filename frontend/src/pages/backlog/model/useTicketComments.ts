import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { queryShownState } from '@/shared/api/queryState';
import {
  TicketRepository,
  ticketCommentsQuery,
  ticketKeys,
  type TicketComment,
  type TicketCommentBlock,
} from '@/entities/ticket';

export interface TicketCommentsState {
  comments: TicketComment[];
  loading: boolean;
  error: string | null;
}

const LOAD_FAILED = 'コメントを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';
const NO_COMMENTS: TicketComment[] = [];

/**
 * useTicketComments はチケット 1 件ぶんの発言を読み書きする。
 *
 * 発言は共有の問い合わせ（ticketCommentsQuery）から読む。チケットごとの鍵なので、遅れて返って
 * きた前のチケットの応答が今の画面に混ざらない。書き込みの応答は reflectWrite で映す — 書き込みの
 * 途中に取り直しが挟まっても、飛んでいる取得を止めてから映すので古い一覧で上書きしない。足す・
 * 外すは id で見る（取り直した一覧に既に入っていても二重にしない）。
 *
 * 楽観更新はしない。失敗は投げる（呼び出し側が知らせる）。
 *
 * **編集の応答は反応を運ばない**（backend が常に空配列で返す）。素直に差し替えると
 * 画面上の反応が消えるので、`editComment` は本文・edited・updatedAt だけを差し替え、
 * reactions は手元の値を残す。編集すると編集前の本文が 1 つ増えるので、その発言の編集履歴は
 * 古いものにする。
 */
export function useTicketComments(workspaceSlug: string | undefined, ticketId: string | undefined) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined && ticketId !== undefined;
  const result = useQuery({ ...ticketCommentsQuery(workspaceSlug ?? '', ticketId ?? ''), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);

  const { refetch } = result;
  const refresh = useCallback(() => {
    if (active) void refetch();
  }, [active, refetch]);

  /** 書き込みを送り、書いた時点のチケットの発言へ応答を映す。 */
  const write = useCallback(
    async <T,>(
      run: (slug: string, id: string) => Promise<T>,
      apply: (comments: TicketComment[], result: T) => TicketComment[],
    ): Promise<T> => {
      if (!workspaceSlug || !ticketId) throw new Error('ticket comments: no active target');
      const written = await run(workspaceSlug, ticketId);
      await reflectWrite(queryClient, ticketCommentsQuery(workspaceSlug, ticketId).queryKey, (comments) =>
        apply(comments, written),
      );
      return written;
    },
    [workspaceSlug, ticketId, queryClient],
  );

  const createComment = useCallback(
    (body: TicketCommentBlock[], parentCommentId?: string) =>
      write(
        (slug, id) => TicketRepository.createTicketComment(slug, id, body, parentCommentId),
        (comments, created) => (comments.some((c) => c.id === created.id) ? comments : [...comments, created]),
      ),
    [write],
  );

  const editComment = useCallback(
    async (commentId: string, body: TicketCommentBlock[]) => {
      await write(
        (slug, id) => TicketRepository.updateTicketComment(slug, id, commentId, body),
        (comments, updated) =>
          comments.map((c) =>
            c.id === commentId ? { ...c, body: updated.body, edited: updated.edited, updatedAt: updated.updatedAt } : c,
          ),
      );
      if (workspaceSlug && ticketId) {
        void queryClient.invalidateQueries({ queryKey: ticketKeys.commentEdits(workspaceSlug, ticketId, commentId) });
      }
    },
    [write, workspaceSlug, ticketId, queryClient],
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      await write(
        (slug, id) => TicketRepository.deleteTicketComment(slug, id, commentId),
        (comments) => comments.filter((c) => c.id !== commentId),
      );
    },
    [write],
  );

  /** 204 で本体が返らないので、成功を受けてから手元の反応を足す。 */
  const addReaction = useCallback(
    async (commentId: string, emoji: string, userId: number) => {
      await write(
        (slug, id) => TicketRepository.addTicketCommentReaction(slug, id, commentId, emoji),
        (comments) =>
          comments.map((c) =>
            c.id === commentId && !c.reactions.some((r) => r.userId === userId && r.emoji === emoji)
              ? { ...c, reactions: [...c.reactions, { userId, emoji }] }
              : c,
          ),
      );
    },
    [write],
  );

  /** 204 で本体が返らないので、成功を受けてから手元の反応を外す。 */
  const removeReaction = useCallback(
    async (commentId: string, emoji: string, userId: number) => {
      await write(
        (slug, id) => TicketRepository.removeTicketCommentReaction(slug, id, commentId, emoji),
        (comments) =>
          comments.map((c) =>
            c.id === commentId
              ? { ...c, reactions: c.reactions.filter((r) => !(r.userId === userId && r.emoji === emoji)) }
              : c,
          ),
      );
    },
    [write],
  );

  return {
    comments: data ?? NO_COMMENTS,
    loading,
    error: failed ? LOAD_FAILED : null,
    refresh,
    createComment,
    editComment,
    deleteComment,
    addReaction,
    removeReaction,
  };
}
