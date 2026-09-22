import type { KbCommentThread } from '@/entities/kb';
import type { CommentAnchor } from '@/shared/ui/RichTextEditor';
import KbCommentComposer from './KbCommentComposer';
import KbCommentThreadCard from './KbCommentThreadCard';

export interface KbCommentsPanelProps {
  threads: KbCommentThread[];
  loading: boolean;
  error: string | null;
  /** コメント権限が無ければ、作成フォーム・返信欄・解決/再開ボタンを出さない。読むことは誰でもできる。 */
  canComment: boolean;
  /**
   * 本文の選択範囲から作りかけの錨（バブルメニューの「コメント」ボタン経由）。非 null の間は
   * 「新しいスレッドを作成」（page-level）の代わりに「選択範囲へコメント」フォームを出す
   * （同時に 2 つの作成フォームを出さない）。
   */
  pendingAnchor: CommentAnchor | null;
  /** 「選択範囲へコメント」フォームのキャンセル。 */
  onCancelPendingAnchor: () => void;
  onCreateThread: (body: unknown[], anchor?: CommentAnchor) => Promise<void>;
  onReply: (threadId: string, body: unknown[]) => Promise<void>;
  onResolve: (threadId: string) => Promise<void>;
  onReopen: (threadId: string) => Promise<void>;
}

/**
 * KbCommentsPanel はコメントパネルの中身。未解決を先に、解決済みを後に並べる。
 *
 * 状態は受け取るだけで、自分では取りに行かない（取得は useKbComments が持つ）。
 * SharePanel と同じ流儀 — こうしておくと、読み込み中・空・失敗の見た目を story に
 * そのまま並べられる。
 */
export default function KbCommentsPanel({
  threads,
  loading,
  error,
  canComment,
  pendingAnchor,
  onCancelPendingAnchor,
  onCreateThread,
  onReply,
  onResolve,
  onReopen,
}: KbCommentsPanelProps) {
  const unresolved = threads.filter((thread) => thread.resolvedAt === null);
  const resolved = threads.filter((thread) => thread.resolvedAt !== null);

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* 選択範囲からの作成（錨付き）。page-level の作成フォームとは同時に出さない
          （pendingAnchor が有る間は下の「新しいスレッドを作成」を隠す）。 */}
      {canComment && !loading && pendingAnchor && (
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <h3 className="text-[0.6875rem] font-bold tracking-wide text-[var(--color-text-muted)]">
              選択範囲へコメント
            </h3>
            <button
              type="button"
              onClick={onCancelPendingAnchor}
              className="text-[0.6875rem] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline"
            >
              キャンセル
            </button>
          </div>
          {/* 引用文（quote）。落ち着いた色の左罫線でブロック引用らしく見せる。 */}
          <blockquote className="mb-2 border-l-2 border-surface-3 pl-2 text-xs italic leading-relaxed text-[var(--color-text-muted)]">
            {pendingAnchor.quote}
          </blockquote>
          <KbCommentComposer
            placeholder="コメントを書く…"
            onSubmit={(body) => onCreateThread(body, pendingAnchor)}
          />
        </div>
      )}

      {/* 一覧の取得中は作成フォームを出さない（useKbComments 側で取得と書き込みの競合は
          解消済みだが、それでも「まだ読めていない一覧の上に新規作成を重ねさせない」という
          最低限の防御として残す）。 */}
      {canComment && !loading && !pendingAnchor && (
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
          <h3 className="mb-1.5 text-[0.6875rem] font-bold tracking-wide text-[var(--color-text-muted)]">
            新しいスレッドを作成
          </h3>
          <KbCommentComposer placeholder="コメントを書く…" onSubmit={onCreateThread} />
        </div>
      )}

      {loading && (
        // 件数は分からないので 2 行に固定する（実際の件数に寄せると、読み込みのたびに高さが跳ねる）。
        <div className="flex flex-col gap-1.5" role="status" aria-label="コメントを読み込み中">
          <div className="h-16 animate-skeleton rounded bg-surface-2" />
          <div className="h-16 animate-skeleton rounded bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}

      {!loading && !error && threads.length === 0 && (
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          まだコメントはありません。
        </p>
      )}

      {!loading && !error && unresolved.length > 0 && (
        <section aria-label="未解決のスレッド">
          <h3 className="mb-1.5 text-[0.6875rem] font-bold tracking-wide text-[var(--color-text-muted)]">
            未解決（{unresolved.length}）
          </h3>
          <ul className="flex flex-col gap-2">
            {unresolved.map((thread) => (
              <li key={thread.id}>
                <KbCommentThreadCard
                  thread={thread}
                  canComment={canComment}
                  onReply={onReply}
                  onResolve={onResolve}
                  onReopen={onReopen}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {!loading && !error && resolved.length > 0 && (
        <section aria-label="解決済みのスレッド">
          <h3 className="mb-1.5 text-[0.6875rem] font-bold tracking-wide text-[var(--color-text-muted)]">
            解決済み（{resolved.length}）
          </h3>
          <ul className="flex flex-col gap-2">
            {resolved.map((thread) => (
              <li key={thread.id}>
                <KbCommentThreadCard
                  thread={thread}
                  canComment={canComment}
                  onReply={onReply}
                  onResolve={onResolve}
                  onReopen={onReopen}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
