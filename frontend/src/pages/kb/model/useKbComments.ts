import { useCallback, useEffect, useRef, useState } from 'react';
import { KbRepository, type KbCommentThread } from '@/entities/kb';
import type { CommentAnchor } from '@/shared/ui/RichTextEditor';

export interface KbCommentsState {
  threads: KbCommentThread[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
  /** スレッド作成・返信・解決・再開のいずれかが飛んでいる間 true。 */
  saving: boolean;
}

const EMPTY: KbCommentsState = {
  threads: [],
  loading: false,
  error: null,
  saving: false,
};

const LOAD_FAILED =
  'コメントを読み込めませんでした。通信が切れたか、このページを見る立場でなくなっています。開き直すと最新の状態が出ます。';

/** どのページのコメントを見ているか。応答が着地してよいかの判定にこれを使う。 */
interface CommentsTarget {
  key: string;
  workspaceSlug: string;
  pageId: string;
}

function targetOf(
  workspaceSlug: string | undefined,
  pageId: string | undefined,
): CommentsTarget | null {
  // ページが決まっていなければ取りに行かない（未確定のページに対して引く意味が無い）。
  if (!workspaceSlug || !pageId) return null;
  // 区切りに全角空白を使うのは、slug にも ID にも現れないため（useKbShare と同じ理由）。
  return { key: `${workspaceSlug} ${pageId}`, workspaceSlug, pageId };
}

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
 * **workspaceSlug と pageId が両方揃っていれば、パネルの開閉に関わらず常に取得する**
 * （useKbPageDoc と同じ思想）。コメントが付いているブロックへ件数バッジ（RichTextEditor 側）
 * を常時表示する都合上、パネルを開いていない間もスレッド一覧を保持しておく必要がある
 * ——「パネルが開いている間だけ取りに行く」という最適化はできない（バッジがエディタ側に
 * 常時出るため、コメントを使わない人のページでも取得を省けない）。
 *
 * 応答は **要求を始めたときの宛先**（workspaceSlug + pageId の組）が今も見られている
 * ときだけ反映する。応答より先に別ページへ移っていたら、古い応答で新しい画面を
 * 上書きしない。宛先が無くなったら（ページ未確定に戻った）状態も畳む — 残しておくと、
 * 次にページが決まった瞬間に前のページのスレッドが一瞬出る。
 *
 * 作成・返信・解決・再開は、**成功した応答をそのまま使って該当箇所だけ更新する**
 * （一覧を丸ごと引き直さない）。すべて **失敗を投げる** — 知らせ（トースト）は
 * 呼び出し側（KbPage）が出す。
 */
export function useKbComments(workspaceSlug: string | undefined, pageId: string | undefined) {
  const [state, setState] = useState<KbCommentsState>(EMPTY);

  // いま見ている宛先。応答が着地してよいかをこれで判定する。
  const active = useRef<CommentsTarget | null>(null);
  // 要求の連番。宛先だけでは、同じ宛先への 2 本目が飛んでいる最中に 1 本目が着地して
  // 古い一覧で上書きされる取り違えを見分けられない（useKbShare と同じ理由）。
  // ページを離れてすぐ同じページへ戻った場合も key は変わらないが、seq は
  // load() 自身の呼び出しで必ず進むため、mutate（後述）が古い書き込み応答を
  // 弾く判定にも流用できる（key の一致だけでは開き直しを見分けられない）。
  const seq = useRef(0);
  // 書き込み（作成・返信・解決・再開）が成功して state.threads を書き換えた回数。
  // load() が「取得を始めた後に書き込みが割り込んで成功したか」を判定するのに使う
  // （作成成功後に古い一覧応答が着地すると、作成済みスレッドが画面から消えてしまう。
  // 取得を丸ごと state に反映する前に、割り込みが無かったかを見る）。
  const writeCount = useRef(0);
  const target = targetOf(workspaceSlug, pageId);
  const targetKey = target?.key ?? null;

  const load = useCallback(async (to: CommentsTarget) => {
    const request = ++seq.current;
    const writesAtStart = writeCount.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const threads = await KbRepository.listCommentThreads(to.workspaceSlug, to.pageId);
      if (active.current?.key !== to.key || seq.current !== request) return;
      if (writeCount.current !== writesAtStart) {
        // 取得中に書き込みが成功していた。取得結果は書き込み前のスナップショットで
        // 古いので threads は上書きしない（読み込み状態だけ終える）。
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      setState({ threads, loading: false, error: null, saving: false });
    } catch {
      if (active.current?.key !== to.key || seq.current !== request) return;
      if (writeCount.current !== writesAtStart) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }
      setState({ ...EMPTY, error: LOAD_FAILED });
    }
  }, []);

  useEffect(() => {
    active.current = target;
    if (!target) {
      // ページが決まっていない（未選択 or workspaceSlug/pageId のどちらかが欠けている）。
      // 連番を進めて、飛んでいる応答を無効にする（同じページへすぐ戻っても、前回の応答は着地しない）。
      seq.current += 1;
      setState(EMPTY);
      return;
    }
    void load(target);
    // target は毎描画で作り直すオブジェクトなので、鍵で比べる。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, load]);

  /**
   * mutate は書き込みを 1 回行い、成功した応答を apply で状態へ反映する。
   *
   * 宛先は**呼んだ時点**のもの（active.current）。応答が返る前に宛先が変わっていたら、
   * 画面の状態には触らない（触ると、移った先のパネルに旧ページのスレッドが混ざる）。
   * **key の一致だけでは不十分** — パネルを閉じてすぐ同じページを開き直すと key は
   * 変わらないが、それは別の閲覧セッション。呼んだ時点の seq も併せて確認し、
   * 開き直し後に古い書き込み応答が紛れ込む（スレッド・返信が二重に増える）のを防ぐ。
   * 成功して反映したら writeCount を進め、飛んでいる古い
   * load() がこの書き込みより古い取得結果で threads を上書きしないようにする。
   * **失敗は投げる**（呼び出し側 KbPage がトーストで知らせる）。
   */
  const mutate = useCallback(
    async <T,>(
      run: (to: CommentsTarget) => Promise<T>,
      apply: (prev: KbCommentsState, result: T) => KbCommentsState,
    ): Promise<void> => {
      const to = active.current;
      if (!to) return;
      const request = seq.current;
      setState((prev) => ({ ...prev, saving: true }));
      try {
        const result = await run(to);
        if (active.current?.key === to.key && seq.current === request) {
          writeCount.current += 1;
          setState((prev) => apply({ ...prev, saving: false }, result));
        }
      } catch (cause) {
        if (active.current?.key === to.key && seq.current === request) {
          setState((prev) => ({ ...prev, saving: false }));
        }
        throw cause;
      }
    },
    [],
  );

  // anchor を渡すと「選択範囲へのコメント」（錨付き）になる。渡さなければ従来通り
  // page-level のスレッドを作る（KbCommentsPanel の「新しいスレッドを作成」フォーム）。
  const createThread = useCallback(
    (body: unknown[], anchor?: CommentAnchor) =>
      mutate(
        (to) => KbRepository.createCommentThread(to.workspaceSlug, to.pageId, body, anchor),
        (prev, thread) => ({ ...prev, threads: [...prev.threads, thread] }),
      ),
    [mutate],
  );

  const reply = useCallback(
    (threadId: string, body: unknown[]) =>
      mutate(
        (to) => KbRepository.addComment(to.workspaceSlug, to.pageId, threadId, body),
        (prev, comment) => ({
          ...prev,
          threads: prev.threads.map((thread) =>
            thread.id === threadId
              ? { ...thread, comments: [...thread.comments, comment] }
              : thread,
          ),
        }),
      ),
    [mutate],
  );

  const resolve = useCallback(
    (threadId: string) =>
      mutate(
        (to) => KbRepository.resolveCommentThread(to.workspaceSlug, to.pageId, threadId),
        (prev, thread) => ({
          ...prev,
          threads: applyResolutionState(prev.threads, threadId, {
            resolvedAt: thread.resolvedAt,
            resolvedBy: thread.resolvedBy,
          }),
        }),
      ),
    [mutate],
  );

  const reopen = useCallback(
    (threadId: string) =>
      mutate(
        (to) => KbRepository.reopenCommentThread(to.workspaceSlug, to.pageId, threadId),
        (prev, thread) => ({
          ...prev,
          threads: applyResolutionState(prev.threads, threadId, {
            resolvedAt: thread.resolvedAt,
            resolvedBy: thread.resolvedBy,
          }),
        }),
      ),
    [mutate],
  );

  /** 取得に失敗したときの再読み込み（いまの宛先で取り直す）。 */
  const retry = useCallback(() => {
    if (active.current) void load(active.current);
  }, [load]);

  return { ...state, createThread, reply, resolve, reopen, retry };
}
