import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { ticketCommentEditsQuery, type TicketCommentEdit } from '@/entities/ticket';

export interface CommentEditsState {
  edits: TicketCommentEdit[];
  loading: boolean;
  error: string | null;
}

const NO_EDITS: TicketCommentEdit[] = [];

/**
 * useCommentEdits は「（編集済み）」を開いた発言 1 件ぶんの編集前の本文を引く。
 *
 * 一覧に混ぜて先読みする口が無いので、開いている間（`open`）だけ問い合わせる。共有の問い合わせ
 * （ticketCommentEditsQuery）から読むので、閉じて開き直しても取ってある分を出し、発言を編集したら
 * 書き込みの側（useTicketComments）が古いものにする。読めなかったら、閉じて開き直すと取り直す。
 */
export function useCommentEdits(workspaceSlug: string, ticketId: string, commentId: string, open: boolean): CommentEditsState {
  const result = useQuery({ ...ticketCommentEditsQuery(workspaceSlug, ticketId, commentId), enabled: open });
  const { data, loading, failed } = queryShownState(result, open);
  return { edits: data ?? NO_EDITS, loading, error: failed ? '編集履歴を読み込めませんでした。' : null };
}
