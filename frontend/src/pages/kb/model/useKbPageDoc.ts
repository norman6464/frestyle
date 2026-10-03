import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  KbRepository,
  reflectKbPageInTrees,
  rememberVisitedPage,
  forgetVisitedPageIfMatches,
  type KbIcon,
  type KbPage,
  type KbPageContentSaveResult,
  type KbResolvedPage,
} from '@/entities/kb';
import { getApiError } from '@/shared/lib/classifyApiError';
import type { SaveStatus } from '@/shared/lib/saveStatus';

export interface KbPageDocState {
  data: KbResolvedPage | null;
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
}

/** 打鍵が止まってから保存を撃つまでの間合い。 */
const SAVE_DEBOUNCE_MS = 800;

/**
 * useKbPageDoc は /kb/{pageId} の URL からページを解決し、本文の保存も持つ。
 *
 * URL にはページ ID しか無いので、所属ワークスペース（以降の API に要る slug）と
 * 編集可否はサーバーの解決 API が一緒に返す。404 は「無い」と「見えない」の両方を
 * 意味する。backend が撃ち分けていないので（撃ち分けると ID の総当たりで実在が
 * 分かる）、**フロントで「見る権限がありません」と書いてはいけない。**
 */
export function useKbPageDoc(pageId: string | undefined) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<KbPageDocState>({ data: null, loading: pageId !== undefined, error: null });
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle');
  // ページが変わったら、描いている途中で読み込み中へ切り替える（effect の頭で切り替えると、
  // 前の状態のまま 1 回描いてから描き直す）。前のページの本文は読み終えるまで出したまま。
  const [shownPageId, setShownPageId] = useState(pageId);
  if (shownPageId !== pageId) {
    setShownPageId(pageId);
    setState((prev) => (pageId ? { ...prev, loading: true, error: null } : { data: null, loading: false, error: null }));
    setSaveStatus('idle');
  }
  // 本文保存が block_id_conflict（409）で失敗した回数。0 は「まだ起きていない」。
  // 呼び出し側（KbPage）はこの値が変わるたびに再読み込みを促す通知を出す
  // （boolean だと同じ真値が続くだけで2回目以降の発火を検知できないため回数にする）。
  const [contentConflictCount, setContentConflictCount] = useState(0);
  // 本文保存が unknown_attachment（400。このページの添付ではない添付が本文にある）で失敗した回数。
  // 再送しても直らない（その添付を取り除くまで断られ続ける）ので、上と同じく回数で知らせる。
  const [unknownAttachmentCount, setUnknownAttachmentCount] = useState(0);

  // 速く行き来したときに、古い応答が新しいページを上書きするのを防ぐ。
  const generation = useRef(0);

  // 保存のデバウンスと「最後に書かれた doc」。タイマーは 1 本だけ持ち、
  // 発火時点の最新 doc を送る（打鍵ごとに PUT しない）。
  //
  // **宛先（どのページの本文か）は doc と一緒に束ねて持つ。** 別々の ref に置くと、
  // ページを移った瞬間に宛先だけが新しいページへ差し替わり、旧ページの書きかけが
  // 新しいページへ PUT される（丸ごと置換の API なので、移った先の本文が旧ページの
  // 全文で上書きされる）。書いた時点のページが宛先 — この束がそれを崩れなくする。
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 保留は宛先（ページ）ごとに最新の doc を 1 つずつ持つ（Map は挿入順を保つ）。
  // 1 枠だけだと、旧ページの PUT が飛んでいる間に旧ページを書き直し → 移動 → 新ページを
  // 書く、の並びで旧ページの最後の編集が新ページの doc に上書きされて消える。
  // ページ単位の丸ごと置換なので、ページごとに最後の doc が届けば十分。
  const pendingSaves = useRef(
    new Map<string, { workspaceSlug: string; pageId: string; doc: unknown }>(),
  );
  const saveTarget = useRef<{ workspaceSlug: string; pageId: string } | null>(null);
  // PUT が飛んでいる間 true。保存は**必ず 1 本ずつ**送る。並行に送ると、後から書いた
  // 本文の PUT が先に完了し、古い本文の PUT が後から着地して上書きすることがある
  //（丸ごと置換の API なので、順序が崩れる＝最後の入力が消える）。
  const saveInFlight = useRef(false);

  // 進行中の PUT を、復元（waitForPendingSaveToSettle）が待てるように保持する。
  // flushSave が「続けて送る」で自分自身を再帰的に呼ぶと、この ref は新しい PUT の
  // promise で上書きされる — waitForPendingSaveToSettle 側は saveInFlight（真偽値）を
  // 見て「まだ何か進行中か」を判定し、この ref はその「何か」を await する手段でしかない。
  const saveInFlightPromise = useRef<Promise<void> | null>(null);

  const flushSave = useCallback((): Promise<void> => {
    // 続けて送るときに自分を呼ぶので、名前付きの関数にする（useCallback の変数を中から呼ぶと、
    // React Compiler が「宣言より前に使っている」としてこの hook ごと対象から外す）。
    function send(): Promise<void> {
      if (saveInFlight.current) return saveInFlightPromise.current ?? Promise.resolve();
      const head = pendingSaves.current.entries().next();
      if (head.done) return Promise.resolve();
      const [key, pending] = head.value;
      pendingSaves.current.delete(key);
      saveInFlight.current = true;
      setSaveStatus('saving');
      const promise = KbRepository.replaceContent(pending.workspaceSlug, pending.pageId, pending.doc)
        .then((res) => {
          saveInFlight.current = false;
          // 画面は現在ユーザーの名前を持っていないので、保存後の「最終編集」はこの応答で
          // 更新する。移った先で戻ってきた応答（pending.pageId が古い画面のページ）は
          // 反映しない — 反映すると、いま見ているページの最終編集が別ページのものになる。
          setState((prev) => {
            if (!prev.data || prev.data.page.id !== pending.pageId) return prev;
            return {
              ...prev,
              data: { ...prev.data, lastEditedBy: res.lastEditedBy, lastEditedAt: res.lastEditedAt },
            };
          });
          if (pendingSaves.current.size === 0) {
            setSaveStatus('saved');
            return;
          }
          // 送信中にさらに書かれていた。次を続けて送る（書いた順を守る）。
          // 呼び出し元が最後まで待てるよう、続きの promise をそのまま返す（チェーン）。
          setSaveStatus('unsaved');
          return send();
        })
        .catch((err) => {
          saveInFlight.current = false;
          setSaveStatus('unsaved');
          // ブロック id の衝突（別ページの id を乗っ取ろうとした・他クライアントとの
          // 並行編集で起きるレース）は、この画面の状態を書き換えても再送で直らない
          // （エディタ側が古いページの block id を持ったままの可能性がある）。
          // 呼び出し側で再読み込みを促す通知を出せるよう、原因を区別して伝える。
          const serverCode = getApiError(err).serverCode;
          if (serverCode === 'block_id_conflict') {
            setContentConflictCount((n) => n + 1);
          }
          if (serverCode === 'unknown_attachment') {
            setUnknownAttachmentCount((n) => n + 1);
          }
        });
      saveInFlightPromise.current = promise;
      return promise;
    }
    return send();
  }, []);

  /**
   * waitForPendingSaveToSettle は、進行中/保留中の自動保存があれば片づくまで待つ。
   *
   * 版の復元（handleRestoreVersion）の直前に呼ぶ。復元は API 呼び出しの経路が自動保存
   * （flushSave / PUT .../content）とは別（POST .../versions/:seq/restore）なので、
   * 待たずに復元だけ叩くと、先に飛んでいた自動保存の応答が復元の**後**に着地して、
   * 復元した古い内容を打鍵済みの内容で上書きしてしまう競合が実際にある。
   *
   * 復元は今の内容を明示的に置き換える操作なので、まだ送っていない保留（デバウンス待ち）は
   * ここで捨てる（flush はしない）。既に PUT が飛んでいる分だけ、その完了を待つ。
   */
  const waitForPendingSaveToSettle = useCallback(
    async (pageId: string): Promise<void> => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
      pendingSaves.current.delete(pageId);
      if (saveInFlight.current) {
        await flushSave();
      }
    },
    [flushSave],
  );


  useEffect(() => {
    // ページが変わったら（外れても）、前のページの応答は捨てる。
    const token = ++generation.current;
    if (!pageId) return;

    KbRepository.resolvePage(pageId)
      .then((data) => {
        if (token !== generation.current) return;
        saveTarget.current = { workspaceSlug: data.workspaceSlug, pageId: data.page.id };
        setState({ data, loading: false, error: null });
        // ヘッダーの「ナレッジ」ボタンや素の /kb が「前回の続き」へ戻れるよう覚えておく
        // (entities/kb/lib/lastVisitedPage.ts)。開けた時点で覚える — 編集は必ず
        // 開いた後に起きるので、これで「閲覧・編集した」の両方をカバーできる。
        rememberVisitedPage(pageId);
      })
      .catch(() => {
        if (token !== generation.current) return;
        setState({
          data: null,
          loading: false,
          error: 'このページを開けませんでした。移動または削除された可能性があります。',
        });
        // 覚えていたのがこのページ(削除・移動済み)なら忘れる。次回はここへ戻らず、
        // 最初に見つかるページへ自動で移れるようにする。
        forgetVisitedPageIfMatches(pageId);
      });

    return () => {
      // ページを離れるとき、書きかけがあれば待たずに送る（デバウンス分の取りこぼし防止）。
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
        void flushSave();
      }
    };
  }, [pageId, flushSave]);

  /**
   * renameTitle は題名を変える。**失敗は投げる**（呼び出し側が入力を保って知らせる）。
   * 成功したら画面の状態を確定後の値で差し替え、木の控え（左の列・すべてのページ）も差し替える。
   */
  const renameTitle = useCallback(async (title: string): Promise<void> => {
    const target = saveTarget.current;
    if (!target) return;
    const token = generation.current;
    const page = await KbRepository.renamePage(target.workspaceSlug, target.pageId, title);
    // 応答が返る前に別ページへ移っていたら、画面の状態には触らない
    //（触ると、移った先の見出しと ID が前のページのもので上書きされる）。
    // 改名そのものはサーバーで成立しているので、木の控えは差し替える。
    if (token === generation.current) {
      setState((prev) => (prev.data ? { ...prev, data: { ...prev.data, page } } : prev));
    }
    await reflectKbPageInTrees(queryClient, target.workspaceSlug, page);
  }, [queryClient]);

  /**
   * changeIcon はページのアイコンを設定・解除する（`icon` が null なら解除）。
   * **失敗は投げる**（renameTitle と同じ理由 — 呼び出し側がトーストで知らせる）。
   * 成功したら画面の状態を確定後の値で差し替え、木の控えも差し替える。
   */
  const changeIcon = useCallback(async (icon: KbIcon | null): Promise<void> => {
    const target = saveTarget.current;
    if (!target) return;
    const token = generation.current;
    const page = icon
      ? await KbRepository.setPageIcon(target.workspaceSlug, target.pageId, icon)
      : await KbRepository.clearPageIcon(target.workspaceSlug, target.pageId);
    // 応答が返る前に別ページへ移っていたら、画面の状態には触らない（renameTitle と同じ守り）。
    if (token === generation.current) {
      setState((prev) => (prev.data ? { ...prev, data: { ...prev.data, page } } : prev));
    }
    await reflectKbPageInTrees(queryClient, target.workspaceSlug, page);
  }, [queryClient]);

  /**
   * changeCover はページのカバー画像を設定・解除する（`key` が null なら解除）。
   *
   * **アップロード自体はここでは行わない。** 渡す key は呼び出し側
   * （KbPageCoverButton）が KbRepository.uploadPageImage で S3 へ上げ終えた後のもの
   * — バリデーション・アップロード・設定の一連の流れは 1 箇所（呼び出し側）にまとめる。
   *
   * **失敗は投げる**（changeIcon と同じ理由 — 呼び出し側がトーストで知らせる）。
   * 成功したら画面の状態を確定後の値（page・cover）で差し替え、木の控えも差し替える。
   */
  const changeCover = useCallback(async (key: string | null): Promise<void> => {
    const target = saveTarget.current;
    if (!target) return;
    const token = generation.current;
    const { page, cover } = key
      ? await KbRepository.setPageCover(target.workspaceSlug, target.pageId, key)
      : await KbRepository.clearPageCover(target.workspaceSlug, target.pageId);
    // 応答が返る前に別ページへ移っていたら、画面の状態には触らない（changeIcon と同じ守り）。
    if (token === generation.current) {
      setState((prev) => (prev.data ? { ...prev, data: { ...prev.data, page, cover } } : prev));
    }
    await reflectKbPageInTrees(queryClient, target.workspaceSlug, page);
  }, [queryClient]);

  /**
   * applyRestoredContent は版の復元（useKbPageVersions.restoreVersion）が成功した後、
   * その応答をこのページの本文へ反映する。**API 呼び出しはここでは行わない**
   * — 叩くのは useKbPageVersions.restoreVersion（版一覧・復元 API を持つのはあちら）。
   * ここは flushSave の成功ハンドラと同じ安全策だけを担う。
   *
   * 宛先（pageId）は**呼び出し側（KbPage）が復元を開始した時点**のもの。応答が返る前に
   * 別ページへ移っていたら、画面の状態には触らない（flushSave が pending.pageId で
   * 見ているのと同じ理由 — 触ると、移った先の本文が前のページの復元結果で上書きされる）。
   */
  const applyRestoredContent = useCallback((pageId: string, result: KbPageContentSaveResult) => {
    setState((prev) => {
      if (!prev.data || prev.data.page.id !== pageId) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          doc: result.doc,
          lastEditedBy: result.lastEditedBy,
          lastEditedAt: result.lastEditedAt,
        },
      };
    });
  }, []);

  /**
   * reloadPage はこのページを GET で引き直し、応答をそのまま画面の状態へ差し替える。
   *
   * 提案の採用（useKbPageSuggestions.accept）は本文を直接書き換える別経路の API
   * （POST .../suggestions/:id/accept）で、自動保存（flushSave・PUT .../content）とは
   * 完全に別系統。採用が成功した直後、この画面が持つ doc / lastEditedBy 等はまだ
   * 反映前の古い値のままなので、呼び出し側（KbPage）が明示的にここを呼んで揃え直す。
   *
   * **自動保存のタイマー・保留（pendingSaves）には触れない** — 反映前の版で上書きすると
   * 自動保存の対象に含めてしまう既存の懸念とは別物（あちらは PUT の応答同士の順序、
   * こちらは採用という別経路の結果を今の画面へ映すだけ）なので、ここでは何もしない。
   */
  const reloadPage = useCallback(async (pageId: string): Promise<void> => {
    const token = generation.current;
    const data = await KbRepository.resolvePage(pageId);
    // 応答が返る前に別ページへ移っていたら、画面の状態には触らない（他の更新系と同じ守り）。
    if (token !== generation.current) return;
    setState({ data, loading: false, error: null });
  }, []);

  /**
   * applyPageUpdate は、ほかの場所（サイドバーの改名など）で変わったページを画面へ映す。
   * 開いているページなら題名・アイコンなどを、祖先ならパンくずの題名を差し替える。
   * 変わっていなければ state を作り直さない（自分の改名の知らせも自分に届くため）。
   */
  const applyPageUpdate = useCallback((page: KbPage) => {
    setState((prev) => {
      if (!prev.data) return prev;
      if (prev.data.page.id === page.id) {
        const merged = { ...prev.data.page, ...page };
        if (JSON.stringify(merged) === JSON.stringify(prev.data.page)) return prev;
        return { ...prev, data: { ...prev.data, page: merged } };
      }
      const ancestors = prev.data.ancestors ?? [];
      if (!ancestors.some((ancestor) => ancestor.id === page.id && ancestor.title !== page.title)) return prev;
      return {
        ...prev,
        data: {
          ...prev.data,
          ancestors: ancestors.map((ancestor) => (ancestor.id === page.id ? { ...ancestor, title: page.title } : ancestor)),
        },
      };
    });
  }, []);

  /** onDocChange はエディタの onChange から呼ぶ。デバウンスして本文を保存する。 */
  const onDocChange = useCallback(
    (doc: unknown) => {
      // 宛先は**書いたこの瞬間**のページ。あとで読むとページ移動で差し替わっている。
      const target = saveTarget.current;
      if (!target) return;
      pendingSaves.current.set(target.pageId, { ...target, doc });
      setSaveStatus('unsaved');
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void flushSave();
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave],
  );

  return {
    ...state,
    saveStatus,
    contentConflictCount,
    unknownAttachmentCount,
    onDocChange,
    renameTitle,
    changeIcon,
    changeCover,
    applyRestoredContent,
    waitForPendingSaveToSettle,
    reloadPage,
    applyPageUpdate,
  };
}
