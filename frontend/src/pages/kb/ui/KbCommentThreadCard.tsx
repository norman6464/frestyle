import { useState } from 'react';
import type { KbCommentThread } from '@/entities/kb';
import { formatTime } from '@/shared/lib/formatters';
import KbCommentComposer from './KbCommentComposer';
import KbCommentItem from './KbCommentItem';

export interface KbCommentThreadCardProps {
  thread: KbCommentThread;
  /** コメント権限が無ければ返信欄・解決/再開ボタンを出さない（読むことは誰でもできる）。 */
  canComment: boolean;
  onReply: (threadId: string, body: unknown[]) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onReopen: (threadId: string) => Promise<void>;
}

/**
 * KbCommentThreadCard はスレッド 1 件（作成者・作成日時・コメントの列挙・解決状態）。
 * 返信欄は「返信」を押したときだけ出す（見本 3a のカードの下の「返信 · 解決」）。
 *
 * 解決/再開の失敗は握り潰す — 知らせ（トースト）は呼び出し側（KbPage）が出す約束
 * （useKbComments の resolve/reopen は失敗を投げる。ここではボタンを押し直せる状態へ
 * 戻すためだけに catch する）。
 */
export default function KbCommentThreadCard({
  thread,
  canComment,
  onReply,
  onResolve,
  onReopen,
}: KbCommentThreadCardProps) {
  const [toggling, setToggling] = useState(false);
  // 返信欄は「返信」を押してから開く。全スレッドに常に欄と送信ボタンを出すと、読むだけの
  // 一覧が入力欄で埋まる（解決済みのスレッドにも出ていた）。
  const [replying, setReplying] = useState(false);
  const resolved = thread.resolvedAt !== null;

  const handleToggle = async () => {
    if (toggling) return;
    setToggling(true);
    try {
      await (resolved ? onReopen(thread.id) : onResolve(thread.id));
    } catch {
      // 知らせは呼び出し側が出す。ここではボタンを押し直せる状態へ戻すだけ。
    } finally {
      setToggling(false);
    }
  };

  return (
    // section ではなく article — section + aria-label は ARIA の landmark（region）になり、
    // 同じ投稿者から複数スレッドが立つと同じラベルの landmark が並んで a11y 検査に引っかかる
    // （landmark-unique）。article はそもそも landmark にならないので、一意なラベルが要らない。
    <article
      // KbPage のバッジクリック→スクロールが scrollIntoView の対象を探すのに使う id。
      id={`comment-thread-${thread.id}`}
      aria-label={`${thread.createdBy.name || '不明なユーザー'} のスレッド`}
      className="flex flex-col gap-2 rounded-lg border border-surface-3 bg-surface-1 p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-col">
          <span className="text-xs font-semibold text-[var(--color-text-primary)]">
            {thread.createdBy.name || '不明なユーザー'}
          </span>
          <span className="text-xs text-[var(--color-text-muted)]">
            {formatTime(thread.createdAt)}
          </span>
        </div>
        {canComment && (
          <button
            type="button"
            onClick={() => void handleToggle()}
            disabled={toggling}
            className="shrink-0 rounded border border-surface-3 px-2 py-1 text-xs text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
          >
            {resolved ? '再開' : '解決'}
          </button>
        )}
      </div>

      {/* 錨付きコメントだけ引用文（quote）を出す。編集で錨の位置がずれても、
          「何に対するコメントだったか」の人が読める手がかりとして残る（スコープ外の
          再アンカリングの代わり）。 */}
      {thread.quote != null && (
        <blockquote className="border-l-2 border-surface-3 pl-2 text-xs italic leading-relaxed text-[var(--color-text-muted)]">
          {thread.quote}
        </blockquote>
      )}

      <div className="flex flex-col gap-2 border-t border-surface-3 pt-2">
        {thread.comments.map((comment) => (
          <KbCommentItem key={comment.id} comment={comment} />
        ))}
      </div>

      {resolved && (
        <p className="text-xs text-[var(--color-text-muted)]">
          {thread.resolvedBy?.name || '不明なユーザー'} が解決済みにしました
          {thread.resolvedAt && `（${formatTime(thread.resolvedAt)}）`}
        </p>
      )}

      {canComment && !replying && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setReplying(true)}
            className="min-h-9 text-xs font-semibold text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            返信
          </button>
        </div>
      )}
      {canComment && replying && (
        <KbCommentComposer
          placeholder="返信を書く…"
          autoFocus
          onCancel={() => setReplying(false)}
          onSubmit={async (body) => {
            await onReply(thread.id, body);
            setReplying(false);
          }}
        />
      )}
    </article>
  );
}
