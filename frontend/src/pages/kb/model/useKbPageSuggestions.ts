import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { KbRepository, kbKeys, kbSuggestionsQuery, type KbPageSuggestion } from '@/entities/kb';

export interface KbPageSuggestionsState {
  suggestions: KbPageSuggestion[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
}

const NO_SUGGESTIONS: KbPageSuggestion[] = [];

const LOAD_FAILED =
  '提案を読み込めませんでした。通信が切れたか、このページを見る立場でなくなっています。';

/**
 * useKbPageSuggestions はページ 1 枚の open な提案一覧と、採用・却下を持つ。
 *
 * 一覧は共有の問い合わせ（kbSuggestionsQuery）から読み、パネルが開いている間だけ取りに行く
 * （版一覧と同じ理由 — 常設のバッジを持たない）。ページごとの鍵なので、別ページへ移ったら
 * 前のページの一覧は出ない。
 *
 * 採用・却下は成功したら一覧からその提案を取り除く（一覧を丸ごと引き直さない）。取り除く前に
 * 飛んでいる取得を止めるので、書き込みより前の古い一覧があとから届いて、処理した提案が
 * 生き返ることはない（reflectWrite）。**失敗は投げる**（呼び出し側 KbPage がトーストで知らせる）。
 */
export function useKbPageSuggestions(workspaceSlug: string | undefined, pageId: string | undefined, open: boolean) {
  const queryClient = useQueryClient();
  const hasTarget = workspaceSlug !== undefined && pageId !== undefined;
  const result = useQuery({ ...kbSuggestionsQuery(workspaceSlug ?? '', pageId ?? ''), enabled: open && hasTarget });
  const missing = result.data === undefined;
  const shown = open && hasTarget;

  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const settle = useCallback(
    async (
      suggestionId: string,
      run: (slug: string, page: string) => Promise<KbPageSuggestion>,
    ): Promise<KbPageSuggestion> => {
      if (!workspaceSlug || !pageId) throw new Error('提案の一覧が確定していないため操作できません。');
      const settled = await run(workspaceSlug, pageId);
      await reflectWrite(queryClient, kbSuggestionsQuery(workspaceSlug, pageId).queryKey, (prev) =>
        prev.filter((s) => s.id !== suggestionId),
      );
      return settled;
    },
    [workspaceSlug, pageId, queryClient],
  );

  // 採用は本文へ反映して版を 1 つ切る。版の一覧を古いものにする（履歴のパネルに出る）。
  const accept = useCallback(
    (suggestionId: string) =>
      settle(suggestionId, async (slug, page) => {
        const accepted = await KbRepository.acceptSuggestion(slug, page, suggestionId);
        void queryClient.invalidateQueries({ queryKey: kbKeys.versions(slug, page) });
        return accepted;
      }),
    [settle, queryClient],
  );

  const reject = useCallback(
    (suggestionId: string) =>
      settle(suggestionId, (slug, page) => KbRepository.rejectSuggestion(slug, page, suggestionId)),
    [settle],
  );

  return {
    suggestions: shown ? (result.data ?? NO_SUGGESTIONS) : NO_SUGGESTIONS,
    // 一覧がまだ無い間だけ読み込み中・失敗を出す。持っている一覧は取り直しの間も失敗しても出し続ける。
    loading: shown && missing && (result.isPending || result.isFetching),
    error: shown && missing && result.isError && !result.isFetching ? LOAD_FAILED : null,
    retry,
    accept,
    reject,
  };
}
