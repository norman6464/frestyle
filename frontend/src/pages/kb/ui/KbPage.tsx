import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useKbFrameLocation, useKbFrameSpace } from '@/widgets/kb-frame';
import { KbSaveAsTemplateButton, KbTemplatePickerModal, useKbPageTemplates } from '@/features/kb-page-templates';
import {
  emptyRichDoc,
  isRichDoc,
  type EditorCommand,
  type CommentAnchor,
  type CommentBadgeCounts,
} from '@/shared/ui/RichTextEditor';
import { FsIcon, fsIcon, Loading, EmptyState, ConfirmModal } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useMediaQuery } from '@/shared/lib/hooks/useMediaQuery';
import { getApiError } from '@/shared/lib/classifyApiError';
import { useKbPageDoc } from '../model/useKbPageDoc';
import { createSubpage } from '../model/createSubpage';
import { resolveEntryPageId } from '../model/resolveEntryPage';
import { useKbImageResolver } from '../model/useKbImageResolver';
import { destinationAfterDeletion } from '../lib/deletionDestination';
import { useDocOutline } from '../model/useDocOutline';
import {
  refreshKbPageTrees,
  forgetVisitedPageIfMatches,
  KbRepository,
  subscribeKbTreeEvents,
  type KbIcon,
} from '@/entities/kb';
import KbPageHeading from './KbPageHeading';
import KbPageEditor from './KbPageEditor';
import KbPageIconButton from './KbPageIconButton';
import KbPageMeta from './KbPageMeta';
import KbPageCover from './KbPageCover';
import KbPageCoverButton from './KbPageCoverButton';
import KbCommentsPanel from './KbCommentsPanel';
import KbVersionsPanel from './KbVersionsPanel';
import KbVersionPreviewBanner from './KbVersionPreviewBanner';
import KbBacklinksSection from './KbBacklinksSection';
import KbSuggestEditButton from './KbSuggestEditButton';
import KbSuggestDraftBanner from './KbSuggestDraftBanner';
import KbSuggestionsPanel from './KbSuggestionsPanel';
import KbRightRail from './KbRightRail';
import type { KbRailTab } from '../model/railTabs';
import KbTocPanel from './KbTocPanel';
import KbFavoriteControl from './KbFavoriteControl';
import KbPageMoreActions from './KbPageMoreActions';
import KbPageBreadcrumb from './KbPageBreadcrumb';
import { useKbComments } from '../model/useKbComments';
import { useKbPageVersions } from '../model/useKbPageVersions';
import { useKbBacklinks } from '../model/useKbBacklinks';
import { useKbSuggestionDraft } from '../model/useKbSuggestionDraft';
import { useKbPageSuggestions } from '../model/useKbPageSuggestions';

/**
 * KbPage はナレッジの画面（左にサイドバー、右に本文）。
 *
 * URL は素の /kb（ページ未選択）と /kb/{pageId} の 2 つ。ページの URL はページ ID
 * だけを持ち、所属ワークスペースはサーバーの解決 API が返す（テナントを URL に
 * 出さない）。編集可否も同じ応答で来て、編集できる人には題名も本文もその場で書ける。
 *
 * ページ未選択（素の /kb）では、続きを resolveEntryPageId に決めさせて
 * /kb/{pageId} へ即座に移る（見せるための画面ではなく、素通りする入口）。
 *
 * 本文の面は報道系サイトの記事面に合わせる：中央 742px の一本柱に、パンくず → 題名（24px）→
 * 公開範囲・ラベル → 最終編集と操作（枠の無い印を縦線で区切る）→ 本文（16px/1.8。段落の間は空けず
 * 空行で空ける。見出しは文字の大きさだけ合わせる）。
 * 借りるのは骨組みと文字の組み方だけで、色は既存のトークン、中身（人・権限・提案・版）は
 * FreStyle のもの。
 */
/** 提案の採用に失敗したときの知らせ。 */
function acceptFailureMessage(cause: unknown): string {
  return getApiError(cause).serverCode === 'suggestion_stale'
    ? 'この提案が作られた後にページが編集されています。最新の内容を確認してから、却下するか提案を出し直してもらってください。'
    : '提案を採用できませんでした';
}

/**
 * カバー画像を変える。ファイルならアップロードしてから設定し、null なら外す。
 *
 * アップロードが終わるまでに別ページへ移っていたら（currentPage が uploadTarget と違えば）
 * 黙って結果を捨てる。部品の外に置くのは、try/catch の中の条件式を React Compiler が扱えず、
 * 部品ごと対象から外すため。
 */
async function uploadAndChangeCover(
  file: File | null,
  uploadTarget: { workspaceSlug: string; pageId: string },
  currentPage: () => { workspaceSlug: string; pageId: string } | null,
  changeCover: (key: string | null) => Promise<void>,
): Promise<void> {
  if (!file) {
    await changeCover(null);
    return;
  }
  const key = await KbRepository.uploadPageImage(uploadTarget.workspaceSlug, uploadTarget.pageId, file);
  const current = currentPage();
  if (!current || current.workspaceSlug !== uploadTarget.workspaceSlug || current.pageId !== uploadTarget.pageId) {
    return;
  }
  await changeCover(key);
}

/** 操作の行の、レールのタブを開く印。記事面の共有アイコンと同じ、枠の無い 32px（指では 44px）。 */
const RAIL_BUTTON_CLASS =
  'relative inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11';
const RAIL_BUTTON_ACTIVE = 'bg-[var(--color-nav-active)] text-[var(--color-text-primary)]';

/** 操作の組（星 | レールのタブ | …）の間の縦の細い線。飾りなので読み上げない。 */
function ActionDivider() {
  return <span aria-hidden="true" className="mx-1 h-6 w-px shrink-0 bg-surface-3" />;
}

export default function KbPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const location = useLocation();
  const { showToast } = useToast();
  const {
    data,
    loading,
    error,
    saveStatus,
    contentConflictCount,
    onDocChange,
    renameTitle,
    changeIcon,
    changeCover,
    applyRestoredContent,
    waitForPendingSaveToSettle,
    reloadPage,
    applyPageUpdate,
  } = useKbPageDoc(pageId);
  // ヘッダー/サイドバーのワークスペース切替から来たときだけ渡ってくる。
  // ページを開いているときは data.workspaceSlug が正なのでそちらを優先する。
  const navigationWorkspaceSlug = (location.state as { workspaceSlug?: string } | null)?.workspaceSlug;
  // 素の /kb の入口が「前回開いたページ」を選んで移ってきたか。記録が古くて開けなければ、
  // 行き止まりを出さずに入口へ戻して選び直す（resolveEntryPageId のコメント）。
  const fromLastVisited = (location.state as { fromLastVisited?: boolean } | null)?.fromLastVisited === true;
  // 枠が今いると判断しているスペース（開けないページから戻る先に使う）。
  const frameSpace = useKbFrameSpace();
  // 枠（左の木と文脈バー）へ今の位置を知らせる。どのスペースの木かはページを取得して初めて
  // 分かる。取得の間は undefined のまま（枠は前の木のまま）にして、同じスペースの中を移る
  // たびに木を取り直さない（別のページへ移る間も data は前のページを指したまま残る）。
  useKbFrameLocation({
    workspaceSlug: data?.workspaceSlug ?? navigationWorkspaceSlug,
    spaceId: data?.page.spaceId,
    activePageId: pageId,
  });

  // 本文保存が block_id_conflict で失敗したら再読み込みを促す。0（未発生）はスキップする
  // （マウント時の初期値で誤発火しないため）。再送しても直らない失敗なので、
  // 「未保存」の表示だけでは原因が伝わらず利用者が気づけない。
  const prevContentConflictCount = useRef(contentConflictCount);
  useEffect(() => {
    if (contentConflictCount === prevContentConflictCount.current) return;
    prevContentConflictCount.current = contentConflictCount;
    showToast(
      'error',
      '他の変更と競合したため本文を保存できませんでした。ページを再読み込みしてやり直してください。',
    );
  }, [contentConflictCount, showToast]);

  // handleChangeCover がアップロード完了後に「まだ同じページを開いているか」を確かめるための、
  // 常に最新のページを指す ref（data はクロージャに古い値が残るため state 変数の直接比較では
  // 判定できない）。
  const currentPageRef = useRef<{ workspaceSlug: string; pageId: string } | null>(null);
  useEffect(() => {
    currentPageRef.current = data ? { workspaceSlug: data.workspaceSlug, pageId: data.page.id } : null;
  }, [data]);

  // ページ未選択(素の /kb)のときだけ動く。続きのページが決まり次第そこへ移るので、
  // 「まだページがありません」を出すのは resolveEntryPageId が null を返したときだけ。
  // 解決の終わりは「どの入口（対象ワークスペース）について終わったか」で持つ。今の入口と
  // 違えば解決中（effect の中で「解決中」を立てると、描いた直後にもう 1 回描き直す）。
  const entryKey = pageId ? null : (navigationWorkspaceSlug ?? '');
  const [entrySettledFor, setEntrySettledFor] = useState<string | null>(null);
  const entryResolving = entryKey !== null && entrySettledFor !== entryKey;
  useEffect(() => {
    if (entryKey === null) return undefined;
    let cancelled = false;
    resolveEntryPageId(queryClient, entryKey || undefined)
      .then((entry) => {
        if (cancelled) return;
        if (entry) {
          navigate(
            `/kb/${entry.pageId}`,
            entry.fromLastVisited ? { replace: true, state: { fromLastVisited: true } } : { replace: true },
          );
          return;
        }
        setEntrySettledFor(entryKey);
      })
      .catch(() => {
        if (!cancelled) setEntrySettledFor(entryKey);
      });
    return () => {
      cancelled = true;
    };
  }, [entryKey, navigate, queryClient]);
  // ページを開いたら入口の結果は捨てる（次に素の /kb へ来たときは解決し直す）。
  if (pageId && entrySettledFor !== null) setEntrySettledFor(null);

  const retryEntry = Boolean(pageId && fromLastVisited && !loading && error);
  useEffect(() => {
    if (retryEntry) navigate('/kb', { replace: true });
  }, [retryEntry, navigate]);

  const handleRename = useCallback(
    async (title: string) => {
      try {
        await renameTitle(title);
      } catch (cause) {
        showToast('error', '題名を変更できませんでした');
        // 入力を保たせるため、失敗は握り潰さず投げ直す（KbPageTitle 側の約束）。
        throw cause;
      }
    },
    [renameTitle, showToast],
  );

  const handleChangeIcon = useCallback(
    async (icon: KbIcon | null) => {
      // 知らせの文言は try の外で決める（try/catch の中の条件式は React Compiler が扱えず、部品ごと対象から外す）。
      const failure = icon ? 'アイコンを変更できませんでした' : 'アイコンを外せませんでした';
      try {
        await changeIcon(icon);
      } catch (cause) {
        showToast('error', failure);
        // ピッカーを開いたままにするため、握り潰さず投げ直す（KbPageIconPicker 側の約束）。
        throw cause;
      }
    },
    [changeIcon, showToast],
  );

  /**
   * handleChangeCover は「ファイルを渡されたらアップロードしてから設定する・null なら外す」を
   * まとめて担う（changeCover 自身は既にアップロード済みの key しか受け取らない）。
   * アップロード → 設定の一連の API 呼び出しをここ 1 箇所にまとめる。
   *
   * アップロード先は呼び出し時点のページ（uploadTarget）に固定する。アップロードが終わる
   * までに別ページへ移っていたら、そのページの key を新しいページの cover API へ送ることに
   * なってしまう（key の接頭辞が食い違い backend には invalid_cover_key で拒否されるだけだが、
   * 移動先のページに無関係な失敗トーストが出て、元のページの変更も失われる）。
   * currentPageRef と食い違っていたら黙って結果を捨てる。
   */
  const handleChangeCover = useCallback(
    async (file: File | null) => {
      if (!data) return;
      const uploadTarget = { workspaceSlug: data.workspaceSlug, pageId: data.page.id };
      const failure = file ? 'カバー画像を変更できませんでした' : 'カバー画像を外せませんでした';
      try {
        await uploadAndChangeCover(file, uploadTarget, () => currentPageRef.current, changeCover);
      } catch (cause) {
        showToast('error', failure);
        throw cause;
      }
    },
    [changeCover, data, showToast],
  );

  const { resolveImageSrc } = useKbImageResolver(data?.workspaceSlug, data?.page.id);

  // 自分か祖先が物理削除されたら、残っている一番近い親へ移る（消えた場所に立ち続けない）。
  // 親が無ければスペースの概要へ（destinationAfterDeletion）。素の /kb へ戻すと、入口が
  // 「前回開いたページ」＝今消えたページを選んで「ページを開けません」になるので、その記録も外す。
  // 消えたページの URL を履歴に残さないよう置き換えで移る（戻るで消えたページへ行かない）。
  // 祖先はサーバー応答（ancestors — アーカイブ済みも含む）で知っているので、
  // サイドバーの現役の木に載っていないページを開いていても正しく判定できる。
  // ワークスペースごと削除されたとき（配下は FK CASCADE で全消去）は一覧へ戻る。
  // ほかの場所（サイドバーの改名など）で自分か祖先が変わったら、題名とパンくずへ映す。
  useEffect(() => {
    if (!pageId || !data) return undefined;
    return subscribeKbTreeEvents((event) => {
      if (event.type === 'page-deleted') {
        const destination = destinationAfterDeletion(event.pageId, pageId, data.ancestors, data.page.spaceId);
        if (destination === null) return;
        forgetVisitedPageIfMatches(pageId);
        navigate(destination, { replace: true });
        return;
      }
      if (event.type === 'page-updated') {
        applyPageUpdate(event.page);
        return;
      }
      if (event.type === 'workspace-deleted' && event.workspaceSlug === data.workspaceSlug) {
        navigate('/kb');
      }
    });
  }, [pageId, data, navigate, applyPageUpdate]);

  // '/page': 子ページを作って本文にリンクを挿し、作ったページを開く。
  //
  // '/' メニューの項目はエディタ生成時に固定される（RichTextEditor の契約）ので、
  // run の closure には ref を握らせ、実行時点の最新の data を読ませる。
  // 「ページ」という業務の語彙はこの画面が持ち、エディタは項目を並べるだけ。
  // 描いている途中で ref を書き換えない（コンパイラが部品ごと対象から外す）。描き終えた直後に写す。
  const subpageContext = useRef({ data, navigate, showToast, queryClient });
  useLayoutEffect(() => {
    subpageContext.current = { data, navigate, showToast, queryClient };
  }, [data, navigate, showToast, queryClient]);
  // 題名で Enter → 本文の先頭へ（見出しから書き出しへ流れるように移る）。
  const [bodyFocusSignal, setBodyFocusSignal] = useState(0);

  // 右レール（目次・コメント・履歴・提案の 1 枚）の開閉と、開いているタブ。見本 3a のとおり
  // 同時に見えるのは 1 つ。あくまで「レールの見た目を出すかどうか」の UI 状態で、データ取得の
  // トリガーではない（コメントはバッジ表示のため常に取得し、履歴・提案は開いている間だけ取る）。
  // ページを移ったら目次へ戻す（前のページのコメントや版を開いたまま題名だけ変わると読めない）。
  // 広い画面では目次を開いた状態から始める（見本 3a の既定）。狭い画面では引き出しになるので閉じておく。
  const wide = useMediaQuery('(min-width: 768px)');
  const [rail, setRail] = useState<{ open: boolean; tab: KbRailTab }>(() => ({ open: wide, tab: 'toc' }));
  const openRail = useCallback((tab: KbRailTab) => setRail({ open: true, tab }), []);
  // 操作バーのボタンは「そのタブで開く／同じタブが開いていれば閉じる」。
  const toggleRail = useCallback(
    (tab: KbRailTab) => setRail((prev) => (prev.open && prev.tab === tab ? { ...prev, open: false } : { open: true, tab })),
    [],
  );
  const tocOpen = rail.open && rail.tab === 'toc';
  const commentsOpen = rail.open && rail.tab === 'comments';
  const historyOpen = rail.open && rail.tab === 'history';
  const suggestionsOpen = rail.open && rail.tab === 'suggestions';
  const comments = useKbComments(data?.workspaceSlug, data?.page.id);
  const unresolvedCommentCount = comments.threads.filter((thread) => !thread.resolvedAt).length;

  // 本文の選択範囲から作りかけの錨（バブルメニューの「コメント」ボタン経由）。
  // ページを移ったら、前のページの選択に基づく作りかけを持ち越さない。
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);

  const handleCreateThread = useCallback(
    async (body: unknown[], anchor?: CommentAnchor) => {
      try {
        await comments.createThread(body, anchor);
        // 送信できたら作りかけの錨を消す（同じ選択に対して二重に作れてしまわないように）。
        setPendingAnchor(null);
      } catch (cause) {
        showToast('error', 'コメントを送信できませんでした');
        throw cause;
      }
    },
    [comments, showToast],
  );

  const handleCancelPendingAnchor = useCallback(() => {
    setPendingAnchor(null);
  }, []);

  const handleReplyToThread = useCallback(
    async (threadId: string, body: unknown[]) => {
      try {
        await comments.reply(threadId, body);
      } catch (cause) {
        showToast('error', 'コメントを送信できませんでした');
        throw cause;
      }
    },
    [comments, showToast],
  );

  const handleResolveThread = useCallback(
    async (threadId: string) => {
      try {
        await comments.resolve(threadId);
      } catch (cause) {
        showToast('error', 'スレッドを解決できませんでした');
        throw cause;
      }
    },
    [comments, showToast],
  );

  const handleReopenThread = useCallback(
    async (threadId: string) => {
      try {
        await comments.reopen(threadId);
      } catch (cause) {
        showToast('error', 'スレッドを再開できませんでした');
        throw cause;
      }
    },
    [comments, showToast],
  );

  // ブロックIDごとの未解決コメント件数（RichTextEditor 側の件数バッジ用）。解決済みは
  // 数えない — バッジは「見に行く価値がある未解決」の目印であって、履歴の表示ではない。
  const commentBadgeCounts = useMemo<CommentBadgeCounts>(() => {
    const counts: CommentBadgeCounts = {};
    for (const thread of comments.threads) {
      if (thread.resolvedAt || !thread.blockId) continue;
      counts[thread.blockId] = (counts[thread.blockId] ?? 0) + 1;
    }
    return counts;
  }, [comments.threads]);

  // バッジをクリックしたら、パネルを開いて該当スレッドまでスクロールする。パネルが
  // 閉じていた場合、KbCommentsPanel（と中のスレッドカード）はこの後の再描画で初めて
  // DOM に現れるため、スクロールは「パネルが開いた（＝commentsOpen）」と「まだ果たして
  // いないスクロール先が有る」の両方が揃ってから行う（下の useEffect）。
  // 押すたびに新しい依頼（seq）を作り、果たした依頼は ref に覚える。同じスレッドを 2 回押しても
  // 2 回運ぶ。果たしたことを state に書き戻すと、effect の中で state を変えることになる。
  const [scrollRequest, setScrollRequest] = useState<{ threadId: string; seq: number } | null>(null);
  const scrolledSeq = useRef(0);
  const handleCommentBadgeClick = useCallback(
    (blockId: string) => {
      const target = comments.threads.find((thread) => thread.blockId === blockId && !thread.resolvedAt);
      openRail('comments');
      if (target) setScrollRequest((prev) => ({ threadId: target.id, seq: (prev?.seq ?? 0) + 1 }));
    },
    [comments.threads, openRail],
  );
  useEffect(() => {
    if (!commentsOpen || !scrollRequest || scrollRequest.seq === scrolledSeq.current) return;
    scrolledSeq.current = scrollRequest.seq;
    // 凝ったハイライトは持たせない(最低限、見える位置まで運ぶだけで十分)。
    document.getElementById(`comment-thread-${scrollRequest.threadId}`)?.scrollIntoView({ behavior: 'smooth' });
  }, [commentsOpen, scrollRequest]);

  // 版の一覧は useKbPageVersions が「履歴のタブが開いているか」を見て自分でゲートする
  // (useKbComments と違い、版一覧は常設のバッジを持たないので開いている間だけ取りに行く)。
  const versions = useKbPageVersions(data?.workspaceSlug, data?.page.id, historyOpen);

  // 「雛形から作る」ピッカー（/template コマンド用）の開閉。コメント・履歴と同じ理由で
  // ページを移ったら必ず閉じる。一覧の取得はピッカーが開いている間だけ行う（open ゲート）。
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const templates = useKbPageTemplates(data?.workspaceSlug, data?.page.spaceId, templatePickerOpen);

  /**
   * テンプレートを選んで新しいページを作る（/template コマンドの本体）。
   * **失敗は投げる**（KbTemplatePickerModal がフォーム内にエラーを出す。ここで握り潰さない）。
   *
   * 今のページの子として作る（/page が子ページを作るのと同じ置き方 — カーソル位置への
   * 挿入は行わない。テンプレートの本文（doc）を取得する専用の GET が backend に無いため、
   * この機能は「一覧から選んで新しいページを作る」に留めている。PR 説明に明記）。
   */
  const handleCreateFromTemplate = useCallback(
    async (templateId: string, title: string) => {
      if (!data) return;
      const created = await templates.createPageFromTemplate({
        templateId,
        parentId: data.page.id,
        title,
      });
      void refreshKbPageTrees(queryClient, data.workspaceSlug, created.spaceId);
      setTemplatePickerOpen(false);
      navigate(`/kb/${created.id}`);
    },
    [data, templates, navigate, queryClient],
  );

  // 「このページを参照しているページ」（逆リンク）。折りたたみの開閉には依存せず、
  // ページを開いたら常に取得する（見出しの件数表示に使うため — useKbComments と同じ考え方）。
  const backlinks = useKbBacklinks(data?.workspaceSlug, data?.page.id);
  // 目次（見出し）と読了時間は本文から作る。読了時間は backend の応答には無く、決定済みの
  // 計算式を手元で適用するだけ。書きながら見出しを足せば、打つ手が止まったところで増える
  // （本文の状態 data.doc は読み込み時の物で、打鍵では変わらないので、別に保つ）。
  const { headings, readMinutes, update: updateOutline } = useDocOutline(data?.doc);
  const handleDocChange = useCallback(
    (doc: unknown) => {
      onDocChange(doc);
      updateOutline(doc);
    },
    [onDocChange, updateOutline],
  );
  // 目次の飛び先（本文の見出しの DOM）を探す起点。
  const articleRef = useRef<HTMLElement | null>(null);


  // 「この版に戻す」の確認ダイアログ。KbRowActions の削除確認と同じ形 —
  // 確定した瞬間に閉じ、実行(失敗時の知らせ)は非同期のまま進める。
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);

  // ページを移ったら、そのページについて開いていたもの（コメントの作りかけ・雛形の選択・
  // 版の復元の確認）を閉じ、右の欄は目次へ戻す（前のページのコメントや版を開いたまま題名だけ
  // 変わると読めない）。狭い画面になったら右の欄の引き出しを閉じる（本文の中のリンクから
  // 移ったときも取り残さない）。effect で戻すと前のページのまま 1 回描いてしまうので、
  // 描いている途中で前の値と比べて戻す。
  const [uiScope, setUiScope] = useState({ pageId, wide });
  if (uiScope.pageId !== pageId || uiScope.wide !== wide) {
    const pageChanged = uiScope.pageId !== pageId;
    setUiScope({ pageId, wide });
    if (pageChanged) {
      setPendingAnchor(null);
      setTemplatePickerOpen(false);
      setRestoreConfirmOpen(false);
    }
    setRail((prev) => ({ open: wide ? prev.open : false, tab: 'toc' }));
  }

  const handleCreateVersion = useCallback(
    async (note?: string) => {
      try {
        await versions.createVersion(note);
      } catch (cause) {
        showToast('error', '版を残せませんでした');
        // フォーム側(KbVersionSaveForm)にも入力を保ったまま知らせるため、再 throw する。
        throw cause;
      }
    },
    [versions, showToast],
  );

  const handleRestoreVersion = useCallback(async () => {
    if (!data || !versions.selected) return;
    const seq = versions.selected.seq;
    // 宛先は**復元を始めた時点**のページ。応答が返る前に別ページへ移っていても、
    // useKbPageDoc.applyRestoredContent 側で「今のページと違えば触らない」安全策を踏む
    // (flushSave と同じ約束)。
    const targetPageId = data.page.id;
    try {
      // 進行中/保留中の自動保存を先に片づけてから復元する。待たずに復元だけ叩くと、
      // 先に飛んでいた自動保存の応答が復元の後に着地して、復元した内容を打鍵済みの
      // 内容で上書きしてしまう競合が実際にある。
      await waitForPendingSaveToSettle(targetPageId);
      const result = await versions.restoreVersion(seq);
      applyRestoredContent(targetPageId, result);
    } catch {
      showToast('error', 'この版に戻せませんでした');
    }
  }, [data, versions, applyRestoredContent, waitForPendingSaveToSettle, showToast]);

  // 提案の一覧も履歴と同じ流儀（開いている間だけ取る）。canView であれば誰でも開ける
  // （backend の一覧 API が CanView だけで許可するのと同じ考え方）。
  const suggestions = useKbPageSuggestions(data?.workspaceSlug, data?.page.id, suggestionsOpen);

  /**
   * commenter の「変更を提案する」ドラフトモード。既存の自動保存（useKbPageDoc の
   * flushSave・デバウンス・onDocChange）とは完全に別系統の状態機械（useKbSuggestionDraft）。
   * ここでは開始（本文の今の doc を下書きの初期値にする）と、送信成功時のトーストだけを持つ
   * — 失敗時の知らせは帯（KbSuggestDraftBanner）自身がエラー state を出すので、ここでは
   * 何もしない。
   */
  const suggestionDraft = useKbSuggestionDraft(data?.workspaceSlug, data?.page.id);

  const handleToggleSuggestDraft = useCallback(() => {
    if (suggestionDraft.open) {
      suggestionDraft.cancel();
      return;
    }
    // data.doc は壊れた保存などで isRichDoc を満たさないことがある
    // （本文表示側と同じ防御。RichTextEditor に無効な doc をそのまま渡さない）。
    if (data) suggestionDraft.start(isRichDoc(data.doc) ? data.doc : emptyRichDoc());
  }, [suggestionDraft, data]);

  const handleSubmitSuggestion = useCallback(async () => {
    const ok = await suggestionDraft.submit();
    if (ok) showToast('success', '提案として送信しました');
  }, [suggestionDraft, showToast]);

  /**
   * 採用が成功すると本文が変わる。応答（accept の doc）をそのまま使わず、ページを
   * GET で引き直す（useKbPageDoc.reloadPage）— そちらなら lastEditedBy/lastEditedAt も
   * 一緒に最新化される（accept の応答は提案そのものであって、ページ全体の情報は持たない）。
   *
   * 採用の直前に waitForPendingSaveToSettle を呼ぶ — 採用は自動保存（PUT .../content）とは
   * 別経路（POST .../suggestions/:id/accept）なので、待たずに叩くと、先に飛んでいた
   * 自動保存の応答が採用の**後**に着地して、採用した内容を古い自動保存の内容で
   * 上書きしてしまう競合がある（handleRestoreVersion と同じ理由）。
   */
  const handleAcceptSuggestion = useCallback(
    async (suggestionId: string) => {
      if (!data) return;
      const targetPageId = data.page.id;
      try {
        await waitForPendingSaveToSettle(targetPageId);
        await suggestions.accept(suggestionId);
        await reloadPage(targetPageId);
      } catch (cause) {
        showToast('error', acceptFailureMessage(cause));
        // KbSuggestionsPanel 側がボタンを押し直せる状態へ戻すため、再 throw する。
        throw cause;
      }
    },
    [data, suggestions, reloadPage, showToast, waitForPendingSaveToSettle],
  );

  const handleRejectSuggestion = useCallback(
    async (suggestionId: string) => {
      try {
        await suggestions.reject(suggestionId);
      } catch (cause) {
        showToast('error', '提案を却下できませんでした');
        throw cause;
      }
    },
    [suggestions, showToast],
  );

  // '/template': テンプレートのピッカーを開く。run は editor を受け取らず、状態を
  // 切り替えるだけ（setTemplatePickerOpen は useState のセッター＝常に同一の参照なので、
  // subpageContext のような ref 越しの読み出しが要らない — この呼び出しが
  // 「エディタ生成時に固定される」制約に触れるのはこの 1 点だけで、`run` の中身自体は
  // 常に最新のセッターを指したまま変わらない）。
  // 題名の見出しと本文（KbPageHeading・KbPageEditor）は memo で包んである。渡す関数をここで固定し、
  // ページの中の小さな操作（保存状態・右の欄のタブ・星）で見出しと本文を描き直さない。
  const handleTitleEnter = useCallback(() => setBodyFocusSignal((prev) => prev + 1), []);
  const handleNavigateToPage = useCallback((path: string) => navigate(path), [navigate]);
  const handleRequestComment = useCallback(
    (anchor: CommentAnchor) => {
      setPendingAnchor(anchor);
      openRail('comments');
    },
    [openRail],
  );
  const imageUploadTarget = data?.canEdit ? { workspaceSlug: data.workspaceSlug, pageId: data.page.id } : null;
  const uploadWorkspaceSlug = imageUploadTarget?.workspaceSlug;
  const uploadPageId = imageUploadTarget?.pageId;
  const handleImageUpload = useMemo(
    () =>
      uploadWorkspaceSlug && uploadPageId
        ? (file: File) => KbRepository.uploadPageImage(uploadWorkspaceSlug, uploadPageId, file)
        : undefined,
    [uploadWorkspaceSlug, uploadPageId],
  );

  const extraSlashCommands = useMemo<EditorCommand[]>(
    () => [
      {
        id: 'page',
        label: 'ページ',
        group: 'insert',
        glyph: 'ページ',
        icon: { set: 'fs', name: 'document' },
        keywords: ['page', 'subpage', 'child'],
        run: (editor) => {
          const ctx = subpageContext.current;
          if (!ctx.data) return;
          void createSubpage(editor, ctx.data, ctx.queryClient)
            .then((path) => ctx.navigate(path))
            .catch(() => ctx.showToast('error', '子ページを作成できませんでした'));
        },
      },
      {
        id: 'template',
        label: 'テンプレート',
        group: 'insert',
        glyph: 'テンプレート',
        icon: { set: 'fs', name: 'document-text' },
        keywords: ['template', 'wireframe'],
        run: () => setTemplatePickerOpen(true),
      },
    ],
    [],
  );

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <main className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto w-full max-w-[calc(742px+3rem)] px-4 py-6 sm:px-6 sm:py-8">
          {/* pageId 無し(素の /kb)は resolveEntryPageId が続きを決めている間だけ通る道で、
              ほとんどの場合は決まり次第 /kb/{id} へ移ってしまう。ここに残るのは、
              1 枚もページが見つからなかった(ワークスペースが空)ときだけ。 */}
          {!pageId && entryResolving && <Loading className="py-16" />}
          {!pageId && !entryResolving && (
            <EmptyState
              headingLevel={1}
              icon={fsIcon('document-text')}
              title="まだページがありません"
              description="左の列（狭い画面では左上のボタン）の「ページを探す」の「＋」から、最初のページを作れます。"
            />
          )}

          {pageId && (loading || retryEntry) && <Loading className="py-16" />}

          {/*
            404 は「無い」と「見えない」の両方。どちらかを名指しすると、
            ID を総当たりするだけで隠したページの実在が分かってしまう。
          */}
          {pageId && !loading && !retryEntry && error && (
            <EmptyState
              headingLevel={1}
              icon={fsIcon('document-text')}
              title="ページを開けません"
              description={error}
              action={
                // 行き止まりにしない。枠がいまのスペースを知っていれば（左の木を出している）、
                // そのスペースの概要へ戻す。消えたページへの本文のリンクや古いブックマークから
                // 来たときも、元いた場所へ 1 回で帰れる。
                frameSpace
                  ? { label: `${frameSpace.name} の概要へ`, onClick: () => navigate(`/kb/spaces/${frameSpace.id}`) }
                  : { label: 'スペース一覧へ戻る', onClick: () => navigate('/kb/spaces') }
              }
            />
          )}

          {pageId && !loading && !error && data && (
            <article ref={articleRef}>
              {/*
                版のプレビュー中の帯。ページ上部(カバー画像より前)に置く — パンくず・題名は
                「今のページ」を指したまま変えず、変わるのは本文だけという設計を明確にする。
                読み込み中・失敗はここで吸収し、揃うまで(下の)本文は出さない
                (途中状態のまま編集可能な本文を触らせないため)。
              */}
              {/*
                ドラフトモード中の帯。版のプレビューより先に見る — 両方が同時に立つことは
                無い想定だが、編集中の下書きを優先して見せる（版プレビューは読み取り専用
                なので、書きかけの下書きを隠す理由が無い）。
              */}
              {suggestionDraft.open && (
                <KbSuggestDraftBanner
                  submitting={suggestionDraft.submitting}
                  error={suggestionDraft.error}
                  onSubmit={() => void handleSubmitSuggestion()}
                  onCancel={suggestionDraft.cancel}
                />
              )}
              {!suggestionDraft.open && versions.selected && versions.selected.loading && (
                <Loading className="py-8" />
              )}
              {!suggestionDraft.open && versions.selected && !versions.selected.loading && versions.selected.error && (
                <EmptyState
                  icon={fsIcon('clock')}
                  title="この版を開けません"
                  description={versions.selected.error}
                  action={{ label: '現在の版に戻る', onClick: versions.clearSelection }}
                />
              )}
              {!suggestionDraft.open && versions.selected && !versions.selected.loading && versions.selected.detail && (
                <KbVersionPreviewBanner
                  createdAt={versions.selected.detail.createdAt}
                  canEdit={data.canEdit}
                  restoring={versions.restoring}
                  onRestore={() => setRestoreConfirmOpen(true)}
                  onClose={versions.clearSelection}
                />
              )}
              {/* カバー画像（設定済みのときだけ）。頭部の最初に置く見せ場なので、パンくずより上。 */}
              <KbPageCover cover={data.cover} />
              {/* パンくずは題名の上の 1 行。操作は題名の下の行に置く（幅が狭いときにパンくずが
                  折り返しても、操作の並びが崩れないようにするため）。 */}
              <KbPageBreadcrumb
                workspaceSlug={data.workspaceSlug}
                workspaceName={data.workspaceName}
                spaceId={data.page.spaceId}
                ancestors={data.ancestors}
                title={data.page.title}
              />
              <div key={data.page.id}>
                <KbPageHeading
                  icon={data.page.icon}
                  title={data.page.title}
                  canEdit={data.canEdit}
                  onRename={handleRename}
                  onChangeIcon={handleChangeIcon}
                  onEnter={handleTitleEnter}
                />
              </div>
              {/*
                題名の下（記事の型）。1 行目に公開範囲・ラベル・閲覧数・読了時間、2 行目の左に最終編集、
                右に操作を並べる（KbPageMeta が組む）。操作は左から 変更を提案する（コメント可の人だけ）→
                お気に入りの星 | 目次 → コメント（未解決の件数）→ 履歴 → 提案 | …（編集できる人だけ）。
                目次・コメント・履歴・提案は右レールの同じ名前のタブを開く（もう一度押すと閉じる）。
                ページ単位の共有（ページごとに人と権限を足す操作）は持たない。見られる人はワークスペースと
                スペースの権限で決まる。
              */}
              <KbPageMeta
                lastEditedBy={data.lastEditedBy}
                lastEditedAt={data.lastEditedAt}
                visibility={data.page.visibility}
                labels={data.labels}
                viewCount={data.viewCount}
                readMinutes={readMinutes}
                // 保存状態はバイラインに常に置く（本文の末尾だと、長いページで見えない）。
                saveStatus={data.canEdit ? saveStatus : undefined}
                access={data.canEdit ? 'edit' : data.canComment ? 'comment' : 'view'}
                actions={
                  <div role="group" aria-label="ページの操作" className="flex flex-wrap items-center gap-0.5">
                    {/*
                      「変更を提案する」は commenter（閲覧+コメントはできるが編集はできない役割）
                      だけに見せる。editor 以上は本文を直接編集できるので提案の必要が無く、
                      viewer はそもそも書けない（提案も本文の書き換えの一種）。
                    */}
                    {data.canComment && !data.canEdit && (
                      <KbSuggestEditButton active={suggestionDraft.open} onToggle={handleToggleSuggestDraft} />
                    )}
                    <KbFavoriteControl
                      key={data.page.id}
                      workspaceSlug={data.workspaceSlug}
                      pageId={data.page.id}
                      initial={data.isFavorite}
                    />
                    <ActionDivider />
                    {/* 目次はレールの既定のタブ。閉じた後に開き直す入口としてもここに置く。 */}
                    <button
                      type="button"
                      onClick={() => toggleRail('toc')}
                      aria-expanded={tocOpen}
                      aria-label="目次"
                      title="目次"
                      className={`${RAIL_BUTTON_CLASS} ${tocOpen ? RAIL_BUTTON_ACTIVE : ''}`}
                    >
                      <FsIcon name="clipboard-list" className="h-4 w-4" />
                    </button>
                    {/* コメントは canComment に関わらず誰でも開ける（読むだけの人にも見せる）。 */}
                    <button
                      type="button"
                      onClick={() => toggleRail('comments')}
                      aria-expanded={commentsOpen}
                      aria-label={
                        unresolvedCommentCount > 0
                          ? `コメント (未解決 ${unresolvedCommentCount} 件)`
                          : 'コメント'
                      }
                      title="コメント"
                      className={`${RAIL_BUTTON_CLASS} ${commentsOpen ? RAIL_BUTTON_ACTIVE : ''}`}
                    >
                      <FsIcon name="chat" className="h-4 w-4" />
                      {unresolvedCommentCount > 0 && (
                        // 未解決の数は「見に行く価値がある」印であって警告ではないので、危険色にしない。
                        <span className="absolute -right-1 -top-1 h-[18px] min-w-[18px] rounded-full bg-[var(--color-nav-selected)] px-1 text-center text-xs font-semibold leading-[18px] text-[var(--color-nav-selected-text)]">
                          {unresolvedCommentCount > 99 ? '99+' : unresolvedCommentCount}
                        </span>
                      )}
                    </button>
                    {/*
                      履歴は閲覧できれば誰でも開ける(canView。canEdit に関わらず)。
                      バッジ・件数表示は持たせない(画面設計の約束 — 版の有無を煽らない)。
                    */}
                    <button
                      type="button"
                      onClick={() => toggleRail('history')}
                      aria-expanded={historyOpen}
                      aria-label="履歴"
                      title="履歴"
                      className={`${RAIL_BUTTON_CLASS} ${historyOpen ? RAIL_BUTTON_ACTIVE : ''}`}
                    >
                      <FsIcon name="clock" className="h-4 w-4" />
                    </button>
                    {/*
                      提案は canView だけで開ける(履歴と同じ考え方 — backend の一覧 API も
                      CanView だけで許可する)。バッジ・件数表示は持たせない(履歴と揃える)。
                    */}
                    <button
                      type="button"
                      onClick={() => toggleRail('suggestions')}
                      aria-expanded={suggestionsOpen}
                      aria-label="提案"
                      title="提案"
                      className={`${RAIL_BUTTON_CLASS} ${suggestionsOpen ? RAIL_BUTTON_ACTIVE : ''}`}
                    >
                      <FsIcon name="lightbulb" className="h-4 w-4" />
                    </button>
                    {data.canEdit && <ActionDivider />}
                    {/*
                      毎回は使わないページの設定（雛形として保存・カバー画像・アイコン）は「…」の中。
                      どれも編集できる人の操作なので、読むだけの人には「…」自体を出さない。
                    */}
                    {data.canEdit && (
                      <KbPageMoreActions>
                        {/*
                          「テンプレートとして保存」は canEdit（このページを編集できる）と
                          workspaceCanEdit（ワークスペース全体への書き込み資格。雛形の作成が実際に
                          要求する権限）の両方が揃ったときだけ出す。ページ/スペース限定の編集権限
                          しか持たない人は canEdit だけ true になり得るので、そちらだけで判定すると
                          「押せるが403になる」ボタンを出してしまう（権限が無い相手に押せるボタンを
                          出しても、返るのは 403 だけで「権限が無い」ことすら伝わらない）。
                        */}
                        {data.workspaceCanEdit && (
                          <KbSaveAsTemplateButton
                            workspaceSlug={data.workspaceSlug}
                            pageId={data.page.id}
                            spaceId={data.page.spaceId}
                          />
                        )}
                        <KbPageCoverButton cover={data.cover} canEdit={data.canEdit} onChange={handleChangeCover} />
                        <KbPageIconButton icon={data.page.icon} canEdit={data.canEdit} onChange={handleChangeIcon} />
                      </KbPageMoreActions>
                    )}
                  </div>
                }
              />
              {/* 本文。記事の組み方（rte-article: 16px/1.8・段落の間は空行・見出しは大きさだけ）で、
                  頭部から 36px 空ける。 */}
              <div className="rte-article mt-9">
                <KbPageEditor
                  data={data}
                  draftOpen={suggestionDraft.open}
                  draft={suggestionDraft.draft}
                  onDraftChange={suggestionDraft.changeDraft}
                  preview={versions.selected}
                  onDocChange={handleDocChange}
                  extraSlashCommands={extraSlashCommands}
                  onNavigateToPage={handleNavigateToPage}
                  onRequestComment={handleRequestComment}
                  commentBadgeCounts={commentBadgeCounts}
                  onCommentBadgeClick={handleCommentBadgeClick}
                  focusSignal={bodyFocusSignal}
                  onImageUpload={handleImageUpload}
                  resolveImageSrc={resolveImageSrc}
                />
              </div>
              {/*
                本文そのものの末尾（コメントパネル等とは別の場所）。通常の読了後に
                スクロールして辿り着く位置に、逆リンクの折りたたみを置く。
              */}
              <KbBacklinksSection
                pages={backlinks.pages}
                loading={backlinks.loading}
                error={backlinks.error}
                onRetry={backlinks.retry}
              />
            </article>
          )}

          {/* 「この版に戻す」の確認。ConfirmModal は isOpen=false のとき自分で null を返すので、
              常に描画してよい(KbRowActions の削除確認と同じ形)。確定した瞬間に閉じ、
              実行(失敗時の知らせ)は非同期のまま進める。 */}
          <ConfirmModal
            isOpen={restoreConfirmOpen}
            title="この版に戻しますか"
            message="現在の内容は上書きされますが、これも新しい版として残るので後から戻せます。"
            confirmText="この版に戻す"
            isDanger={false}
            onConfirm={() => {
              setRestoreConfirmOpen(false);
              void handleRestoreVersion();
            }}
            onCancel={() => setRestoreConfirmOpen(false)}
          />
        </div>
      </main>

      {/*
        右レール。目次・コメント・履歴・提案を 1 枚のタブで切り替える（見本 3a）。
        <main> の後に置くだけで、広い画面では右側に来る（呼び出し側の DOM 順）。
        閉じている間は描かない — 履歴・提案の取得はタブが開いている間だけ走る。
        プレビュー状態(versions.selected)自体はレールの開閉と独立に生きるので、
        閉じても帯(KbVersionPreviewBanner)は消えない。
      */}
      <KbRightRail
        open={rail.open}
        tab={rail.tab}
        onTabChange={openRail}
        onClose={() => setRail((prev) => ({ ...prev, open: false }))}
        unresolvedCommentCount={unresolvedCommentCount}
        panels={{
          toc: <KbTocPanel headings={headings} articleRef={articleRef} />,
          comments: (
            <KbCommentsPanel
              threads={comments.threads}
              loading={comments.loading}
              error={comments.error}
              onRetry={comments.retry}
              canComment={data?.canComment ?? false}
              pendingAnchor={pendingAnchor}
              onCancelPendingAnchor={handleCancelPendingAnchor}
              onCreateThread={handleCreateThread}
              onReply={handleReplyToThread}
              onResolve={handleResolveThread}
              onReopen={handleReopenThread}
            />
          ),
          history: (
            <KbVersionsPanel
              versions={versions.versions}
              loading={versions.loading}
              error={versions.error}
              onRetry={versions.retry}
              canEdit={data?.canEdit ?? false}
              selectedSeq={versions.selected?.seq ?? null}
              onCreateVersion={handleCreateVersion}
              onSelectVersion={versions.selectVersion}
            />
          ),
          suggestions: (
            <KbSuggestionsPanel
              suggestions={suggestions.suggestions}
              loading={suggestions.loading}
              error={suggestions.error}
              onRetry={suggestions.retry}
              canEdit={data?.canEdit ?? false}
              onAccept={handleAcceptSuggestion}
              onReject={handleRejectSuggestion}
            />
          ),
        }}
      />

      {/* /template コマンドが開くピッカー。削除ボタンの表示可否は、雛形の削除が実際に
          要求するワークスペース全体の CanEdit（data.workspaceCanEdit）で判定する
          （data.canEdit はページ単位の権限なので、これだけで判定すると「押せるが
          403になる」削除ボタンを出しかねない）。 */}
      <KbTemplatePickerModal
        isOpen={templatePickerOpen}
        templates={templates.templates}
        loading={templates.loading}
        error={templates.error}
        canManageTemplates={data?.workspaceCanEdit ?? false}
        onConfirm={handleCreateFromTemplate}
        onDelete={templates.deleteTemplate}
        onClose={() => setTemplatePickerOpen(false)}
      />
    </div>
  );
}
