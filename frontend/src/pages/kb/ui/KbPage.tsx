import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { KbSidebar, KbTemplatePickerModal, useKbPageTemplates } from '@/widgets/kb-sidebar';
import { SecondaryPanel } from '@/widgets/secondary-panel';
import {
  RichTextEditor,
  emptyRichDoc,
  isRichDoc,
  extractPlainText,
  type EditorCommand,
  type CommentAnchor,
  type CommentBadgeCounts,
} from '@/shared/ui/RichTextEditor';
import Loading from '@/shared/ui/Loading';
import EmptyState from '@/shared/ui/EmptyState';
import ConfirmModal from '@/shared/ui/ConfirmModal';
import Button from '@/shared/ui/Button';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useMobilePanelState } from '@/shared/lib/hooks/useMobilePanelState';
import { getApiError } from '@/shared/lib/classifyApiError';
import {
  DocumentTextIcon,
  Bars3Icon,
  ChatBubbleLeftRightIcon,
  ClockIcon,
  LightBulbIcon,
} from '@heroicons/react/24/outline';
import { useKbPageDoc } from '../model/useKbPageDoc';
import { createSubpage } from '../model/createSubpage';
import { resolveEntryPageId } from '../model/resolveEntryPage';
import { useKbImageResolver } from '../model/useKbImageResolver';
import { emitKbTreeEvent, KbRepository, subscribeKbTreeEvents, type KbIcon } from '@/entities/kb';
import KbPageTitle from './KbPageTitle';
import KbPageIconButton from './KbPageIconButton';
import KbPageMeta from './KbPageMeta';
import KbPageCover from './KbPageCover';
import KbPageCoverButton from './KbPageCoverButton';
import KbSaveAsTemplateButton from './KbSaveAsTemplateButton';
import KbCommentsPanel from './KbCommentsPanel';
import KbVersionsPanel from './KbVersionsPanel';
import KbVersionPreviewBanner from './KbVersionPreviewBanner';
import KbBacklinksSection from './KbBacklinksSection';
import KbSuggestEditButton from './KbSuggestEditButton';
import KbSuggestDraftBanner from './KbSuggestDraftBanner';
import KbSuggestionsPanel from './KbSuggestionsPanel';
import { SharePanel } from '@/features/permission-sharing';
import { useKbShare } from '../model/useKbShare';
import { useKbComments } from '../model/useKbComments';
import { useKbPageVersions } from '../model/useKbPageVersions';
import { useKbBacklinks } from '../model/useKbBacklinks';
import { useKbSuggestionDraft } from '../model/useKbSuggestionDraft';
import { useKbPageSuggestions } from '../model/useKbPageSuggestions';

/** バイラインの読了時間の見積りに使う速さ（600 字/分・端数切り上げ）。API は無く手元で計算する。 */
const READING_CHARS_PER_MINUTE = 600;

/**
 * KbPage はナレッジの画面（左にサイドバー、右に本文）。
 *
 * URL は素の /kb（ページ未選択）と /kb/{pageId} の 2 つ。ページの URL はページ ID
 * だけを持ち、所属ワークスペースはサーバーの解決 API が返す（テナントを URL に
 * 出さない）。編集可否も同じ応答で来て、編集できる人には題名も本文もその場で書ける。
 *
 * ページ未選択（素の /kb）では、続きを resolveEntryPageId に決めさせて
 * /kb/{pageId} へ即座に移る（見せるための画面ではなく、素通りする入口）。
 */
export default function KbPage() {
  const { pageId } = useParams<{ pageId: string }>();
  const navigate = useNavigate();
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
  } = useKbPageDoc(pageId);
  // ヘッダー/サイドバーのワークスペース切替から来たときだけ渡ってくる。
  // ページを開いているときは data.workspaceSlug が正なのでそちらを優先する。
  const navigationWorkspaceSlug = (location.state as { workspaceSlug?: string } | null)?.workspaceSlug;
  const { isOpen: mobilePanelOpen, open: openMobilePanel, close: closeMobilePanel } = useMobilePanelState();

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
  const [entryResolving, setEntryResolving] = useState(false);
  useEffect(() => {
    if (pageId) return undefined;
    let cancelled = false;
    setEntryResolving(true);
    resolveEntryPageId(navigationWorkspaceSlug)
      .then((id) => {
        if (cancelled) return;
        if (id) {
          navigate(`/kb/${id}`, { replace: true });
          return;
        }
        setEntryResolving(false);
      })
      .catch(() => {
        if (!cancelled) setEntryResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pageId, navigationWorkspaceSlug, navigate]);

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
      try {
        await changeIcon(icon);
      } catch (cause) {
        showToast('error', icon ? 'アイコンを変更できませんでした' : 'アイコンを外せませんでした');
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
      try {
        if (file) {
          const key = await KbRepository.uploadPageImage(uploadTarget.workspaceSlug, uploadTarget.pageId, file);
          const current = currentPageRef.current;
          if (
            !current ||
            current.workspaceSlug !== uploadTarget.workspaceSlug ||
            current.pageId !== uploadTarget.pageId
          ) {
            return;
          }
          await changeCover(key);
        } else {
          await changeCover(null);
        }
      } catch (cause) {
        showToast('error', file ? 'カバー画像を変更できませんでした' : 'カバー画像を外せませんでした');
        throw cause;
      }
    },
    [changeCover, data, showToast],
  );

  const { resolveImageSrc } = useKbImageResolver(data?.workspaceSlug, data?.page.id);

  // 自分か祖先が物理削除されたら一覧へ戻る（消えた場所に立ち続けない）。
  // 祖先はサーバー応答（ancestors — アーカイブ済みも含む）で知っているので、
  // サイドバーの現役の木に載っていないページを開いていても正しく判定できる。
  // ワークスペースごと削除されたとき（配下は FK CASCADE で全消去）も同じ理由で戻る。
  useEffect(() => {
    if (!pageId || !data) return undefined;
    return subscribeKbTreeEvents((event) => {
      if (event.type === 'page-deleted') {
        const hit =
          event.pageId === pageId || (data.ancestors ?? []).some((ancestor) => ancestor.id === event.pageId);
        if (hit) navigate('/kb');
        return;
      }
      if (event.type === 'workspace-deleted' && event.workspaceSlug === data.workspaceSlug) {
        navigate('/kb');
      }
    });
  }, [pageId, data, navigate]);

  // '/page': 子ページを作って本文にリンクを挿し、作ったページを開く。
  //
  // '/' メニューの項目はエディタ生成時に固定される（RichTextEditor の契約）ので、
  // run の closure には ref を握らせ、実行時点の最新の data を読ませる。
  // 「ページ」という業務の語彙はこの画面が持ち、エディタは項目を並べるだけ。
  const subpageContext = useRef({ data, navigate, showToast });
  subpageContext.current = { data, navigate, showToast };
  // 題名で Enter → 本文の先頭へ（見出しから書き出しへ流れるように移る）。
  const [bodyFocusSignal, setBodyFocusSignal] = useState(0);
  // 共有パネルの開閉。ページを移ったら必ず閉じる（別のページの設定を開いたまま
  // 題名だけ変わると、どのページを共有しているのか読めなくなる）。
  const [shareOpen, setShareOpen] = useState(false);
  useEffect(() => {
    setShareOpen(false);
  }, [pageId]);
  // 閉じている間は取りに行かない（開いていないパネルのために毎ページ 2 本引かない）。
  const share = useKbShare(
    shareOpen ? data?.workspaceSlug : undefined,
    shareOpen ? data?.page.id : undefined,
  );

  // コメントパネルの開閉。あくまで「パネルの見た目を出すかどうか」の UI 状態で、データ取得の
  // トリガーではない（useKbComments はバッジ表示のため、開閉に関わらず常に取得する）。
  // 共有パネルと同じ理由でページを移ったら必ず閉じる。
  const [commentsOpen, setCommentsOpen] = useState(false);
  useEffect(() => {
    setCommentsOpen(false);
  }, [pageId]);
  const comments = useKbComments(data?.workspaceSlug, data?.page.id);
  const unresolvedCommentCount = comments.threads.filter((thread) => !thread.resolvedAt).length;

  // 本文の選択範囲から作りかけの錨（バブルメニューの「コメント」ボタン経由）。
  // ページを移ったら、前のページの選択に基づく作りかけを持ち越さない。
  const [pendingAnchor, setPendingAnchor] = useState<CommentAnchor | null>(null);
  useEffect(() => {
    setPendingAnchor(null);
  }, [pageId]);

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
  const [scrollToThreadId, setScrollToThreadId] = useState<string | null>(null);
  const handleCommentBadgeClick = useCallback(
    (blockId: string) => {
      const target = comments.threads.find((thread) => thread.blockId === blockId && !thread.resolvedAt);
      setCommentsOpen(true);
      setScrollToThreadId(target?.id ?? null);
    },
    [comments.threads],
  );
  useEffect(() => {
    if (!commentsOpen || !scrollToThreadId) return;
    // 凝ったハイライトは持たせない(最低限、見える位置まで運ぶだけで十分)。
    document.getElementById(`comment-thread-${scrollToThreadId}`)?.scrollIntoView({ behavior: 'smooth' });
    setScrollToThreadId(null);
  }, [commentsOpen, scrollToThreadId]);

  // 履歴パネルの開閉。あくまで「パネルの見た目を出すかどうか」の UI 状態 — 一覧の取得は
  // useKbPageVersions がこの open を見て自分でゲートする(useKbComments と違い、版一覧は
  // 常設のバッジを持たないので開いている間だけ取りに行く)。共有・コメントと同じ理由で
  // ページを移ったら必ず閉じる。
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => {
    setHistoryOpen(false);
  }, [pageId]);
  const versions = useKbPageVersions(data?.workspaceSlug, data?.page.id, historyOpen);

  // 「雛形から作る」ピッカー（/template コマンド用）の開閉。共有・コメント・履歴と同じ理由で
  // ページを移ったら必ず閉じる。一覧の取得はピッカーが開いている間だけ行う（open ゲート）。
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  useEffect(() => {
    setTemplatePickerOpen(false);
  }, [pageId]);
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
      emitKbTreeEvent({ type: 'page-created', page: created });
      setTemplatePickerOpen(false);
      navigate(`/kb/${created.id}`);
    },
    [data, templates, navigate],
  );

  // 「このページを参照しているページ」（逆リンク）。折りたたみの開閉には依存せず、
  // ページを開いたら常に取得する（見出しの件数表示に使うため — useKbComments と同じ考え方）。
  const backlinks = useKbBacklinks(data?.workspaceSlug, data?.page.id);
  // 読了時間は本文の文字数から見積もる（段2の viewCount と違い、backend の応答には無い —
  // 決定済みの計算式を手元で適用するだけ）。空の本文では出さない（0 分は意味を持たない）。
  const readMinutes = useMemo(() => {
    if (!isRichDoc(data?.doc)) return null;
    const charCount = extractPlainText(data.doc).length;
    return charCount > 0 ? Math.max(1, Math.ceil(charCount / READING_CHARS_PER_MINUTE)) : null;
  }, [data?.doc]);

  // 「この版に戻す」の確認ダイアログ。KbRowActions の削除確認と同じ形 —
  // 確定した瞬間に閉じ、実行(失敗時の知らせ)は非同期のまま進める。
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  useEffect(() => {
    setRestoreConfirmOpen(false);
  }, [pageId]);

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

  // 提案パネルの開閉。履歴・コメントと同じ流儀 — canView であれば誰でも開ける
  // （backend の一覧 API が CanView だけで許可するのと同じ考え方）。ページを移ったら必ず閉じる。
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  useEffect(() => {
    setSuggestionsOpen(false);
  }, [pageId]);
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
    // data.doc は旧応答（デプロイ順）や壊れた保存で isRichDoc を満たさないことがある
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
        showToast(
          'error',
          getApiError(cause).serverCode === 'suggestion_stale'
            ? 'この提案が作られた後にページが編集されています。最新の内容を確認してから、却下するか提案を出し直してもらってください。'
            : '提案を採用できませんでした',
        );
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
  const extraSlashCommands = useMemo<EditorCommand[]>(
    () => [
      {
        id: 'page',
        label: 'ページ',
        group: 'insert',
        glyph: '📄',
        keywords: ['page', 'subpage', 'child'],
        run: (editor) => {
          const ctx = subpageContext.current;
          if (!ctx.data) return;
          void createSubpage(editor, ctx.data)
            .then((path) => ctx.navigate(path))
            .catch(() => ctx.showToast('error', '子ページを作成できませんでした'));
        },
      },
      {
        id: 'template',
        label: 'テンプレート',
        group: 'insert',
        glyph: '📑',
        keywords: ['template', 'wireframe'],
        run: () => setTemplatePickerOpen(true),
      },
    ],
    [],
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* サイドバーはバックログの一覧と同じ機構で出し入れする（« で隠す / 左端ホバーで
          一時表示 / ⌘\ で切替）。画面ごとに別の作りを持たない — 覚えることを増やさない。 */}
      <SecondaryPanel
        title="ナレッジ"
        peekable
        storageKey="frestyle.panel.note"
        resizable
        resizeStorageKey="frestyle.panel.note.width"
        mobileOpen={mobilePanelOpen}
        onMobileClose={closeMobilePanel}
      >
        <KbSidebar
          workspaceSlug={data?.workspaceSlug ?? navigationWorkspaceSlug}
          spaceId={data?.page.spaceId ?? ''}
          activePageId={pageId}
        />
      </SecondaryPanel>

      <main className="min-w-0 flex-1 overflow-y-auto overscroll-contain">
        {/* モバイルヘッダー: md 以上は SecondaryPanel 自身の一時表示機構（左端ホバー / ☰）が
            効くのでここには出さない。md 未満はこのボタンだけがサイドバーを開く唯一の手段。 */}
        <div className="md:hidden bg-surface-1 border-b border-surface-3 px-4 py-2 flex items-center">
          <button
            onClick={openMobilePanel}
            className="p-1.5 hover:bg-surface-2 rounded transition-colors"
            aria-label="ナレッジ一覧を開く"
          >
            <Bars3Icon className="w-5 h-5 text-[var(--color-text-muted)]" />
          </button>
        </div>
        <div className="mx-auto w-full max-w-[900px] px-6 py-10">
          {/* pageId 無し(素の /kb)は resolveEntryPageId が続きを決めている間だけ通る道で、
              ほとんどの場合は決まり次第 /kb/{id} へ移ってしまう。ここに残るのは、
              1 枚もページが見つからなかった(ワークスペースが空)ときだけ。 */}
          {!pageId && entryResolving && <Loading className="py-16" />}
          {!pageId && !entryResolving && (
            <EmptyState
              icon={DocumentTextIcon}
              title="まだページがありません"
              description="左のツリーからページを作成してください。"
            />
          )}

          {pageId && loading && <Loading className="py-16" />}

          {/*
            404 は「無い」と「見えない」の両方。どちらかを名指しすると、
            ID を総当たりするだけで隠したページの実在が分かってしまう。
          */}
          {pageId && !loading && error && (
            <EmptyState
              icon={DocumentTextIcon}
              title="ページを開けません"
              description={error}
            />
          )}

          {pageId && !loading && !error && data && (
            <article>
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
                  icon={ClockIcon}
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
              {/*
                パンくず（場所の表示）。ワークスペース名 → 閲覧できる祖先 → 現在のページ。
                見えない祖先は応答に含まれず、穴があいたまま出す（木と同じ見え方。
                フロントで埋めると、サーバーが伏せた実在を推測で喋ることになる）。
              */}
              {/* パンくずの行と操作ボタンの行は別の行にする（幅が狭いときにパンくずが
                  折り返しても、操作ボタンの並びが崩れないようにするため）。 */}
              <nav aria-label="ページの場所" className="mb-2 flex min-w-0 flex-wrap items-center gap-1 text-xs text-[var(--color-text-muted)]">
                <span className="truncate">{data.workspaceName ?? data.workspaceSlug}</span>
                {/* ?? [] はデプロイ順の防御 — 旧バックエンドの応答（ancestors なし）でも落とさない */}
                {(data.ancestors ?? []).map((ancestor) => (
                  <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
                    <span aria-hidden="true">/</span>
                    <Link
                      to={`/kb/${ancestor.id}`}
                      className="max-w-40 truncate hover:text-[var(--color-text-primary)] hover:underline"
                    >
                      {ancestor.title}
                    </Link>
                  </span>
                ))}
                {/* 区切りは題名と組にして折り返す（独立させると「/」だけが行末に残る） */}
                <span className="flex min-w-0 items-center gap-1">
                  <span aria-hidden="true">/</span>
                  <span aria-current="page" className="max-w-40 truncate text-[var(--color-text-secondary)]">
                    {data.page.title}
                  </span>
                </span>
              </nav>
              <div className="mb-2 flex items-center justify-end gap-2">
                {/* コメントは canComment に関わらず誰でも開ける（読むだけの人にも見せる）。 */}
                <button
                  type="button"
                  onClick={() => setCommentsOpen((open) => !open)}
                  aria-expanded={commentsOpen}
                  aria-label={
                    unresolvedCommentCount > 0
                      ? `コメント (未解決 ${unresolvedCommentCount} 件)`
                      : 'コメント'
                  }
                  className="relative rounded border border-surface-3 p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
                >
                  <ChatBubbleLeftRightIcon className="h-4 w-4" />
                  {unresolvedCommentCount > 0 && (
                    <span className="absolute -right-1 -top-1 h-4 min-w-[16px] rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 text-white">
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
                  onClick={() => setHistoryOpen((open) => !open)}
                  aria-expanded={historyOpen}
                  aria-label="履歴"
                  className="rounded border border-surface-3 p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
                >
                  <ClockIcon className="h-4 w-4" />
                </button>
                {/*
                  提案は canView だけで開ける(履歴と同じ考え方 — backend の一覧 API も
                  CanView だけで許可する)。バッジ・件数表示は持たせない(履歴と揃える)。
                */}
                <button
                  type="button"
                  onClick={() => setSuggestionsOpen((open) => !open)}
                  aria-expanded={suggestionsOpen}
                  aria-label="提案"
                  className="rounded border border-surface-3 p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
                >
                  <LightBulbIcon className="h-4 w-4" />
                </button>
                {/*
                  「変更を提案する」は commenter（閲覧+コメントはできるが編集はできない役割）
                  だけに見せる。editor 以上は本文を直接編集できるので提案の必要が無く、
                  viewer はそもそも書けない（提案も本文の書き換えの一種）。
                */}
                {data.canComment && !data.canEdit && (
                  <KbSuggestEditButton active={suggestionDraft.open} onToggle={handleToggleSuggestDraft} />
                )}
                {/*
                  「テンプレートとして保存」は canEdit（このページを編集できる）と
                  workspaceCanEdit（ワークスペース全体への書き込み資格。雛形の作成が実際に
                  要求する権限）の両方が揃ったときだけ出す。ページ/スペース限定の編集権限
                  しか持たない人は canEdit だけ true になり得るので、そちらだけで判定すると
                  「押せるが403になる」ボタンを出してしまう（共有ボタンの canManage と同じ
                  考え方 — 権限が無い相手に押せるボタンを出しても、返るのは 403 だけで
                  「権限が無い」ことすら伝わらない）。
                */}
                {data.canEdit && data.workspaceCanEdit && (
                  <KbSaveAsTemplateButton
                    workspaceSlug={data.workspaceSlug}
                    pageId={data.page.id}
                    spaceId={data.page.spaceId}
                  />
                )}
                {/*
                  共有は canManage のときだけ出す。権限が無い相手に押せるボタンを出しても、
                  返るのは 404 だけで「権限が無い」ことすら伝わらない。
                */}
                {data.canManage && (
                  <div className="relative">
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setShareOpen((open) => !open)}
                      aria-expanded={shareOpen}
                    >
                      共有
                    </Button>
                    {shareOpen && (
                      <div className="absolute right-0 top-full z-20 mt-1">
                        <SharePanel
                          targetTitle={data.page.title}
                          inheritedNote="上の段（ワークスペース・スペース・親ページ）から届いている人はここには出ません。"
                          emptyNote="このページではまだ誰にも権限を足していません。上の段から届いている人は、ここが空でもこのページを見られます。"
                          rows={share.rows}
                          candidates={share.candidates}
                          loading={share.loading}
                          error={share.error}
                          saving={share.saving}
                          onGrant={share.grant}
                          onRevoke={share.revoke}
                          onClose={() => setShareOpen(false)}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* カバー画像の追加・変更・外す操作。読むだけの人には何も出さない（部品側の約束）。 */}
              <KbPageCoverButton cover={data.cover} canEdit={data.canEdit} onChange={handleChangeCover} />
              {/*
                アイコン → 題名の順（上に乗るものから読む並び）。
                group はアイコン追加ボタンのホバー表示に使う（KbPageIconButton 側の約束）。
                ページごとに作り直す（別ページへ移った瞬間、打ちかけの下書きを持ち越さない）。
              */}
              <div className="group" key={data.page.id}>
                <KbPageIconButton
                  icon={data.page.icon}
                  canEdit={data.canEdit}
                  onChange={handleChangeIcon}
                />
                <KbPageTitle
                  title={data.page.title}
                  canEdit={data.canEdit}
                  onRename={handleRename}
                  onEnter={() => setBodyFocusSignal((prev) => prev + 1)}
                />
              </div>
              <KbPageMeta
                lastEditedBy={data.lastEditedBy}
                lastEditedAt={data.lastEditedAt}
                visibility={data.page.visibility}
                labels={data.labels}
                viewCount={data.viewCount}
                readMinutes={readMinutes}
              />
              {suggestionDraft.open ? (
                // ドラフトモード中。value/onChange は useKbPageDoc の自動保存とは完全に
                // 別系統のローカルなドラフト state（useKbSuggestionDraft）へ繋ぐ —
                // ここで保存されるのは提案としてであって、本文そのものはまだ変わっていない。
                <RichTextEditor
                  value={isRichDoc(suggestionDraft.draft) ? suggestionDraft.draft : emptyRichDoc()}
                  editable={true}
                  onChange={suggestionDraft.changeDraft}
                  ariaLabel={`${data.page.title} の本文（提案を編集中）`}
                  onNavigateToPage={(path) => navigate(path)}
                  resolveImageSrc={resolveImageSrc}
                />
              ) : versions.selected ? (
                // 版のプレビュー中。揃うまで(取得中・失敗)は本文を出さない — 上の帯/読み込み/
                // 失敗の表示に任せる。**コメント関連 props は渡さない**(editable=false と
                // canComment 省略の組み合わせで RichTextEditor 自身がバブルメニュー自体を
                // 出さなくなる — 過去の版に対しては、今のブロックIDに紐づく錨は意味を
                // 持たないため)。
                versions.selected.detail && (
                  <RichTextEditor
                    value={isRichDoc(versions.selected.detail.doc) ? versions.selected.detail.doc : emptyRichDoc()}
                    editable={false}
                    ariaLabel={`${data.page.title} の本文（読み取り専用・過去の版）`}
                    onNavigateToPage={(path) => navigate(path)}
                    resolveImageSrc={resolveImageSrc}
                  />
                )
              ) : (
                <RichTextEditor
                  // doc は API から来る任意の JSON。形が違えば空の本文として扱い、画面を落とさない。
                  value={isRichDoc(data.doc) ? data.doc : emptyRichDoc()}
                  editable={data.canEdit}
                  onChange={onDocChange}
                  saveStatus={data.canEdit ? saveStatus : 'idle'}
                  ariaLabel={`${data.page.title} の本文`}
                  extraSlashCommands={data.canEdit ? extraSlashCommands : undefined}
                  onNavigateToPage={(path) => navigate(path)}
                  onRequestComment={(anchor) => {
                    setPendingAnchor(anchor);
                    setCommentsOpen(true);
                  }}
                  canComment={data?.canComment ?? false}
                  commentBadgeCounts={commentBadgeCounts}
                  onCommentBadgeClick={handleCommentBadgeClick}
                  focusSignal={bodyFocusSignal}
                  onImageUpload={
                    data.canEdit
                      ? (file) => KbRepository.uploadPageImage(data.workspaceSlug, data.page.id, file)
                      : undefined
                  }
                  resolveImageSrc={resolveImageSrc}
                />
              )}
              {/*
                本文そのものの末尾（コメントパネル等とは別の場所）。通常の読了後に
                スクロールして辿り着く位置に、逆リンクの折りたたみを置く。
              */}
              <KbBacklinksSection pages={backlinks.pages} loading={backlinks.loading} />
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
        通常表示（peekable・collapsible 無し）を、開閉トグルで出し入れする。
        SecondaryPanel の通常表示は常時幅を占有するため、閉じている間はレンダリング
        ごとやめる — これで「常時表示」を経由せずに開閉トグルの見た目になる。
        <main> の後に置くだけで、デスクトップでは右側に来る（呼び出し側の DOM 順）。
      */}
      {commentsOpen && (
        <SecondaryPanel
          title="コメント"
          side="right"
          mobileOpen={commentsOpen}
          onMobileClose={() => setCommentsOpen(false)}
        >
          <KbCommentsPanel
            threads={comments.threads}
            loading={comments.loading}
            error={comments.error}
            canComment={data?.canComment ?? false}
            pendingAnchor={pendingAnchor}
            onCancelPendingAnchor={handleCancelPendingAnchor}
            onCreateThread={handleCreateThread}
            onReply={handleReplyToThread}
            onResolve={handleResolveThread}
            onReopen={handleReopenThread}
          />
        </SecondaryPanel>
      )}

      {/* 履歴パネル。コメントパネルと同じ流儀 — 閉じている間はレンダリングごとやめる。
          プレビュー状態(versions.selected)自体はこのパネルの開閉と独立に生きるので、
          閉じても帯(KbVersionPreviewBanner)は消えない。 */}
      {historyOpen && (
        <SecondaryPanel
          title="履歴"
          side="right"
          mobileOpen={historyOpen}
          onMobileClose={() => setHistoryOpen(false)}
        >
          <KbVersionsPanel
            versions={versions.versions}
            loading={versions.loading}
            error={versions.error}
            canEdit={data?.canEdit ?? false}
            selectedSeq={versions.selected?.seq ?? null}
            onCreateVersion={handleCreateVersion}
            onSelectVersion={versions.selectVersion}
          />
        </SecondaryPanel>
      )}

      {/* 提案パネル。履歴・コメントと同じ流儀 — 閉じている間はレンダリングごとやめる。 */}
      {suggestionsOpen && (
        <SecondaryPanel
          title="提案"
          side="right"
          mobileOpen={suggestionsOpen}
          onMobileClose={() => setSuggestionsOpen(false)}
        >
          <KbSuggestionsPanel
            suggestions={suggestions.suggestions}
            loading={suggestions.loading}
            error={suggestions.error}
            canEdit={data?.canEdit ?? false}
            onAccept={handleAcceptSuggestion}
            onReject={handleRejectSuggestion}
          />
        </SecondaryPanel>
      )}

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
