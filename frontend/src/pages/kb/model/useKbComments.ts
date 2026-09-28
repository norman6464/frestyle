import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { reflectWrite } from '@/shared/api/queryCache';
import { KbRepository, kbCommentThreadsQuery, type KbCommentThread } from '@/entities/kb';
import type { CommentAnchor } from '@/shared/ui/RichTextEditor';

export interface KbCommentsState {
  threads: KbCommentThread[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
  /** スレッド作成・返信・解決・再開のいずれかが飛んでいる間 true。 */
  saving: boolean;
}

const NO_THREADS: KbCommentThread[] = [];

const LOAD_FAILED =
  'コメントを読み込めませんでした。通信が切れたか、このページを見る立場でなくなっています。';

/**
 * 解決/再開の応答で、解決状態（resolvedAt / resolvedBy）だけを既存のスレッドへ差し込む。
 *
 * **スレッド全体を応答で置き換えない。** backend の resolve/reopen は発言を引き直さずに
 * 応答を組み立てる設計で、comments が常に空配列で返る（listCommentThreads / createCommentThread
 * とは違う）。丸ごと差し替えると、手元にある発言が解決/再開のたびに消えてしまう。
 */
function applyResolutionState(
  threads: KbCommentThread[],
  threadId: string,
  resolution: Pick<KbCommentThread, 'resolvedAt' | 'resolvedBy'>,
): KbCommentThread[] {
  return threads.map((thread) => (thread.id === threadId ? { ...thread, ...resolution } : thread));
}

/**
 * useKbComments はページ 1 枚のコメントスレッド（未解決・解決済み込み）を読み書きする。
 *
 * **workspaceSlug と pageId が両方揃っていれば、パネルの開閉に関わらず常に取得する**。
 * コメントが付いているブロックへ件数バッジ（RichTextEditor 側）を常時表示する都合上、
 * パネルを開いていない間もスレッド一覧を保持しておく必要がある。
 *
 * 一覧は共有の問い合わせ（kbCommentThreadsQuery）から読む。ページごとの鍵なので、別ページへ
 * 移ったら前のページのスレッドは出ず、遅れて届いた前のページの応答が新しいページを上書きしない。
 *
 * 作成・返信・解決・再開は、**成功した応答をそのまま使って、書いたページの一覧の該当箇所だけ
 * 直す**（一覧を丸ごと引き直さない）。直す前に飛んでいる取得を止めるので、書き込みより前の
 * 古い一覧があとから届いて書いたものが消えることはない（reflectWrite）。作成・返信は id で
 * 重複を見て足すので、書いている間にページを離れて戻り、取り直した一覧に既に入っていても
 * 二重に増えない。すべて **失敗を投げる** — 知らせ（トースト）は呼び出し側（KbPage）が出す。
 */
export function useKbComments(workspaceSlug: string | undefined, pageId: string | undefined) {
  const queryClient = useQueryClient();
  const hasTarget = workspaceSlug !== undefined && pageId !== undefined;
  const result = useQuery({ ...kbCommentThreadsQuery(workspaceSlug ?? '', pageId ?? ''), enabled: hasTarget });
  const view = queryShownState(result, hasTarget);
  // 飛んでいる書き込みの数。1 つでもあれば saving。
  const [inFlight, setInFlight] = useState(0);

  /**
   * write は書き込みを 1 回行い、成功した応答で**書いたページの**一覧を直す。
   * 応答が返る前に別ページへ移っていても、直すのは書いたページの控えなので、移った先の
   * 一覧には混ざらない。**失敗は投げる**（呼び出し側 KbPage がトーストで知らせる）。
   */
  const write = useCallback(
    async <T,>(
      run: (slug: string, page: string) => Promise<T>,
      apply: (prev: KbCommentThread[], written: T) => KbCommentThread[],
    ): Promise<void> => {
      if (!workspaceSlug || !pageId) return;
      setInFlight((n) => n + 1);
      const runAndReflect = async () => {
        const written = await run(workspaceSlug, pageId);
        await reflectWrite(queryClient, kbCommentThreadsQuery(workspaceSlug, pageId).queryKey, (prev) =>
          apply(prev, written),
        );
      };
      await runAndReflect().finally(() => setInFlight((n) => n - 1));
    },
    [workspaceSlug, pageId, queryClient],
  );

  const createThread = useCallback(
    (body: unknown[], anchor?: CommentAnchor) =>
      write(
        (slug, page) => KbRepository.createCommentThread(slug, page, body, anchor),
        (prev, thread) => (prev.some((t) => t.id === thread.id) ? prev : [...prev, thread]),
      ),
    [write],
  );

  const reply = useCallback(
    (threadId: string, body: unknown[]) =>
      write(
        (slug, page) => KbRepository.addComment(slug, page, threadId, body),
        (prev, comment) =>
          prev.map((thread) =>
            thread.id === threadId && !thread.comments.some((c) => c.id === comment.id)
              ? { ...thread, comments: [...thread.comments, comment] }
              : thread,
          ),
      ),
    [write],
  );

  const resolve = useCallback(
    (threadId: string) =>
      write(
        (slug, page) => KbRepository.resolveCommentThread(slug, page, threadId),
        (prev, thread) =>
          applyResolutionState(prev, threadId, { resolvedAt: thread.resolvedAt, resolvedBy: thread.resolvedBy }),
      ),
    [write],
  );

  const reopen = useCallback(
    (threadId: string) =>
      write(
        (slug, page) => KbRepository.reopenCommentThread(slug, page, threadId),
        (prev, thread) =>
          applyResolutionState(prev, threadId, { resolvedAt: thread.resolvedAt, resolvedBy: thread.resolvedBy }),
      ),
    [write],
  );

  /** 取得に失敗したときの再読み込み（いまの宛先で取り直す）。 */
  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    threads: view.data ?? NO_THREADS,
    loading: view.loading,
    error: view.failed ? LOAD_FAILED : null,
    saving: inFlight > 0,
    createThread,
    reply,
    resolve,
    reopen,
    retry,
  };
}
