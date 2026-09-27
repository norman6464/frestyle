import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { KbRepository, kbKeys } from '@/entities/kb';
import { getApiError } from '@/shared/lib/classifyApiError';

export interface KbSuggestionDraftState {
  /** ドラフトモード中か。true の間だけ本文表示エリアが編集可能な下書きに切り替わる。 */
  open: boolean;
  /**
   * 下書きを始めたときの doc（エディタに最初に渡す値）。open=false の間は null。
   * 打鍵の中身はエディタ自身が持ち、ここは打鍵では変わらない（最新の中身は送信のときに使う）。
   */
  draft: unknown;
  /** createSuggestion が飛んでいる間 true。 */
  submitting: boolean;
  /** 失敗の理由。null なら失敗していない。ドラフトは消さずここへ出す。 */
  error: string | null;
}

const CLOSED: KbSuggestionDraftState = { open: false, draft: null, submitting: false, error: null };

/**
 * useKbSuggestionDraft は commenter の「変更を提案する」ドラフトモードを持つ。
 *
 * **既存の useKbPageDoc の自動保存パイプライン（flushSave・デバウンス・onDocChange）とは
 * 完全に別系統。** backend の提案作成 API は作成のみ（既存の open な提案を更新する API が無い）
 * ため、自動保存のようにデバウンスのたびに送ると新しい提案行が量産されてしまう。
 * ここに置くのは「送信」ボタンが押されたときに 1 回だけ createSuggestion を呼ぶ、
 * それだけの状態機械。
 *
 * 失敗は投げない — KbSaveAsTemplateButton と同じ流儀で、エラーはこの state の中に持ち、
 * ドラフトモードのまま・入力を保持したまま呼び出し側（KbPage）が帯に表示する。
 * 成功したかどうかは submit の戻り値（boolean）で呼び出し側へ伝える
 * （成功トーストを出す・失敗トーストは出さない、という出し分けを呼び出し側に委ねるため）。
 *
 * **打鍵の最新の中身は ref に持つ**（state にすると 1 文字ごとにページ全体が描き直される）。
 * 画面に出す中身はエディタが持っているので、ページが知る必要があるのは送信のときだけ。
 */
export function useKbSuggestionDraft(workspaceSlug: string | undefined, pageId: string | undefined) {
  const queryClient = useQueryClient();
  const [state, setState] = useState<KbSuggestionDraftState>(CLOSED);

  // submit が送信中に「別のドラフト」へ移ったか（ページを移った・キャンセルした・新しい
  // ドラフトを開き直した）を検知するための世代カウンタ。応答が着地したとき世代が変わって
  // いたら、もうこの state を持ち主が変わっているとみなし、成功/失敗のどちらでも触らない
  // （移った先のページの下書き state を、古いページへの送信結果で上書きしてしまうため）。
  const generation = useRef(0);
  // 打鍵の最新の中身。送信のときだけ読む。
  const latestDraft = useRef<unknown>(null);

  // ページを移ったら、書きかけの下書きを持ち越さない（共有・コメント・履歴の各パネルと同じ理由）。
  useEffect(() => {
    generation.current += 1;
    latestDraft.current = null;
    setState(CLOSED);
  }, [workspaceSlug, pageId]);

  const start = useCallback((initialDoc: unknown) => {
    generation.current += 1;
    latestDraft.current = initialDoc;
    setState({ open: true, draft: initialDoc, submitting: false, error: null });
  }, []);

  const cancel = useCallback(() => {
    generation.current += 1;
    latestDraft.current = null;
    setState(CLOSED);
  }, []);

  const changeDraft = useCallback((doc: unknown) => {
    latestDraft.current = doc;
  }, []);

  /** submit は下書きを 1 回だけ提案として送る。成功したら true、失敗したら false を返す。 */
  const submit = useCallback(async (): Promise<boolean> => {
    if (!workspaceSlug || !pageId) return false;
    const requestGeneration = generation.current;
    setState((prev) => ({ ...prev, submitting: true, error: null }));
    try {
      await KbRepository.createSuggestion(workspaceSlug, pageId, latestDraft.current);
      // 送った提案をこのページの提案の一覧に出す（パネルを開いていれば取り直し、閉じていれば
      // 次に開いたときに取り直す）。
      void queryClient.invalidateQueries({ queryKey: kbKeys.suggestions(workspaceSlug, pageId) });
      if (generation.current === requestGeneration) setState(CLOSED);
      return true;
    } catch (cause) {
      if (generation.current === requestGeneration) {
        const error =
          getApiError(cause).serverCode === 'too_many_open_suggestions'
            ? '未解決の提案が多すぎます。既存の提案が解決されるのを待ってから送信してください。'
            : '提案を送信できませんでした。';
        setState((prev) => ({ ...prev, submitting: false, error }));
      }
      return false;
    }
  }, [workspaceSlug, pageId, queryClient]);

  return { ...state, start, cancel, changeDraft, submit };
}
