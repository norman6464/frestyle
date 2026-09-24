import type { KbComment } from '@/entities/kb';
import { formatTime } from '@/shared/lib/formatters';

export interface KbCommentItemProps {
  comment: KbComment;
}

/**
 * body（ProseMirror のインラインノードの配列）をプレーンテキストへ変換する。
 *
 * 各ノードの `text` フィールドだけを繋げる。装飾（太字・リンク等）は今回描画しない
 * — マークが付いていても文字そのものは残るので、読めなくなることはない。
 */
function plainTextFromBody(body: unknown[]): string {
  return body
    .map((node) => {
      if (node && typeof node === 'object' && 'text' in node) {
        const text = (node as { text?: unknown }).text;
        return typeof text === 'string' ? text : '';
      }
      return '';
    })
    .join('');
}

/** KbCommentItem はコメント 1 件（投稿者・日時・本文のプレーンテキスト）。 */
export default function KbCommentItem({ comment }: KbCommentItemProps) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-xs font-semibold text-[var(--color-text-primary)]">
          {comment.author.name || '不明なユーザー'}
        </span>
        <span className="text-xs text-[var(--color-text-muted)]">
          {formatTime(comment.createdAt)}
        </span>
      </div>
      <p className="whitespace-pre-wrap break-words text-sm text-[var(--color-text-secondary)]">
        {plainTextFromBody(comment.body)}
      </p>
    </div>
  );
}
