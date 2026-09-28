import { useCallback, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { reflectWrite } from '@/shared/api/queryCache';
import {
  KbRepository,
  kbKeys,
  kbPageVersionQuery,
  kbPageVersionsQuery,
  type KbPageContentSaveResult,
  type KbPageVersion,
  type KbPageVersionDetail,
} from '@/entities/kb';

export interface KbPageVersionsState {
  versions: KbPageVersion[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
  /** 「版を残す」（作成）が飛んでいる間 true。 */
  saving: boolean;
}

const NO_VERSIONS: KbPageVersion[] = [];

const LOAD_FAILED =
  '履歴を読み込めませんでした。通信が切れたか、このページを見る立場でなくなっています。';

/** プレビュー中の版（doc 込み）。選んでいなければ null。 */
export interface KbSelectedVersionState {
  seq: number;
  detail: KbPageVersionDetail | null;
  loading: boolean;
  error: string | null;
}

/**
 * useKbPageVersions はページ 1 枚の版一覧（新しい順）と、選択中の版のプレビュー・
 * 明示的な作成（版を残す）・復元を持つ。
 *
 * **一覧の取得は open（パネルが開いているか）ゲート付き** — useKbComments はバッジ表示の
 * ため開閉に関わらず常時取得するが、版一覧にはその用途が無いので、パネルを開いた人だけが
 * 必要とする。一覧は共有の問い合わせ（kbPageVersionsQuery）から読み、ページごとの鍵なので、
 * 別ページへ移ったら前のページの一覧は出ない。閉じて開き直しても、飛んでいる取得や
 * 取ってある一覧を使い回す。
 *
 * 版を残したら一覧の先頭へ足す（reflectWrite — 書き込みより前の古い一覧があとから届いて、
 * 足した版が消えることはない）。
 *
 * **プレビュー中の版（selected）・復元（restoreVersion）は open に依存しない。**
 * 選んだ版を表示するバナーはパネルを閉じても消えるべきではない
 * （「現在の版に戻る」ボタンだけが明示的な退出手段 — 画面設計の約束）。ページが変わった
 * ときだけ畳む。版は書き換わらないので、1 度取った版の本文は取り直さない。復元がページ本文
 * （useKbPageDoc が持つ data.doc）へ与える影響はここでは扱わない — 呼び出し側（KbPage）が
 * 応答を useKbPageDoc.applyRestoredContent へ渡して反映する。
 */
export function useKbPageVersions(workspaceSlug: string | undefined, pageId: string | undefined, open: boolean) {
  const queryClient = useQueryClient();
  const hasTarget = workspaceSlug !== undefined && pageId !== undefined;
  const pageKey = hasTarget ? `${workspaceSlug} ${pageId}` : null;
  const listResult = useQuery({
    ...kbPageVersionsQuery(workspaceSlug ?? '', pageId ?? ''),
    enabled: open && hasTarget,
  });
  const listView = queryShownState(listResult, open && hasTarget);
  const [saving, setSaving] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // プレビュー中の版は、どのページで選んだかと組で持つ。ページが変わったら（組が合わなければ）
  // 選んでいないのと同じ（effect で畳むと、前のページの版を 1 回描いてしまう）。
  const [selection, setSelection] = useState<{ pageKey: string; seq: number } | null>(null);
  const selectedSeq = selection !== null && selection.pageKey === pageKey ? selection.seq : null;
  const detailResult = useQuery({
    ...kbPageVersionQuery(workspaceSlug ?? '', pageId ?? '', selectedSeq ?? 0),
    enabled: hasTarget && selectedSeq !== null,
  });
  const detailView = queryShownState(detailResult, hasTarget && selectedSeq !== null);
  const detail = detailView.data ?? null;
  const detailLoading = detailView.loading;
  const detailFailed = detailView.failed;
  const selected = useMemo<KbSelectedVersionState | null>(
    () =>
      selectedSeq === null
        ? null
        : {
            seq: selectedSeq,
            detail,
            loading: detailLoading,
            error: detailFailed ? 'この版を読み込めませんでした。' : null,
          },
    [selectedSeq, detail, detailLoading, detailFailed],
  );

  const { refetch } = listResult;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  /**
   * createVersion は今の本文を明示的な版として残す。**失敗は投げる**
   * （呼び出し側 KbPage がトーストで知らせる約束、他の書き込みと同じ）。
   * 成功したら一覧の先頭へ足す（新しい順を保つ）。パネルが開いているとき
   * （= フォームが画面に存在するとき）にしか呼ばれない前提なので、閉じていれば何もしない。
   */
  const createVersion = useCallback(
    async (note?: string): Promise<void> => {
      if (!open || !workspaceSlug || !pageId) return;
      setSaving(true);
      const createAndReflect = async () => {
        const created = await KbRepository.createPageVersion(workspaceSlug, pageId, note);
        await reflectWrite(queryClient, kbPageVersionsQuery(workspaceSlug, pageId).queryKey, (prev) => [
          created,
          ...prev,
        ]);
      };
      await createAndReflect().finally(() => setSaving(false));
    },
    [open, workspaceSlug, pageId, queryClient],
  );

  /** selectVersion は行クリックで版のプレビューを始める（doc 込みの詳細を取得する）。 */
  const selectVersion = useCallback(
    (versionSeq: number) => {
      if (pageKey === null) return;
      setSelection({ pageKey, seq: versionSeq });
    },
    [pageKey],
  );

  /** clearSelection は「現在の版に戻る（閉じる）」。プレビューをやめる。 */
  const clearSelection = useCallback(() => {
    setSelection(null);
  }, []);

  /**
   * restoreVersion はその版を今の本文として復元する。**失敗は投げる**
   * （呼び出し側がトーストで知らせる約束）。
   *
   * 成功したら: プレビューを終える・一覧を取り直させる（復元自体が新しい版になるため —
   * 一覧の先頭に足すだけでは「復元によって生まれた版」の note/author/createdAt が
   * 分からないので、作成のような手元での追記はせず、素直に取り直す）。パネルが閉じていれば
   * 古い印を付けるだけで、次に開いたときに取り直す。**本体ページの doc/lastEditedBy 等への
   * 反映はここでは行わない** — 呼び出し側（KbPage）が応答を useKbPageDoc.applyRestoredContent
   * へ渡して反映する。
   */
  const restoreVersion = useCallback(
    async (versionSeq: number): Promise<KbPageContentSaveResult> => {
      if (!workspaceSlug || !pageId || pageKey === null) {
        throw new Error('ページが確定していないため復元できません。');
      }
      setRestoring(true);
      const restore = async () => {
        const result = await KbRepository.restorePageVersion(workspaceSlug, pageId, versionSeq);
        // 復元した版のプレビューを終える（その間に別ページへ移っていれば、組が合わないので触らない）。
        setSelection((prev) => (prev !== null && prev.pageKey === pageKey ? null : prev));
        void queryClient.invalidateQueries({ queryKey: kbKeys.versions(workspaceSlug, pageId) });
        return result;
      };
      return restore().finally(() => setRestoring(false));
    },
    [workspaceSlug, pageId, pageKey, queryClient],
  );

  return {
    versions: listView.data ?? NO_VERSIONS,
    loading: listView.loading,
    error: listView.failed ? LOAD_FAILED : null,
    saving,
    retry,
    selected,
    restoring,
    createVersion,
    selectVersion,
    clearSelection,
    restoreVersion,
  };
}
