import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { kbBacklinksQuery, type KbPage } from '@/entities/kb';

export interface KbBacklinksState {
  /** このページを参照しているページの一覧。 */
  pages: KbPage[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
  /** 読めなかったときの取り直し。 */
  retry: () => void;
}

const NO_PAGES: KbPage[] = [];

const LOAD_FAILED = '参照しているページを読み込めませんでした。';

/**
 * useKbBacklinks はページ 1 枚の逆リンク（このページを参照しているページ）一覧を取得する。
 *
 * **折りたたみ（KbBacklinksSection）の開閉状態には依存せず、ページを開いたら常に取得する**
 * （useKbComments がバッジ表示のため常時取得するのと同じ考え方 — 件数バッジ相当の表示
 * （セクションの見出しに件数を出す）に使うには、閉じている間も取れていないといけない）。
 *
 * 一覧は共有の問い合わせ（kbBacklinksQuery）から読む。ページごとの鍵なので、別ページへ
 * 移ったら前のページの一覧は出ず、遅れて届いた前のページの応答が新しいページを上書きしない。
 * 読み込み中と失敗を出すのは、一覧が 1 度も取れていないときだけ。
 */
export function useKbBacklinks(workspaceSlug: string | undefined, pageId: string | undefined): KbBacklinksState {
  const hasTarget = workspaceSlug !== undefined && pageId !== undefined;
  const result = useQuery({ ...kbBacklinksQuery(workspaceSlug ?? '', pageId ?? ''), enabled: hasTarget });
  const view = queryShownState(result, hasTarget);

  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    pages: view.data ?? NO_PAGES,
    loading: view.loading,
    error: view.failed ? LOAD_FAILED : null,
    retry,
  };
}
