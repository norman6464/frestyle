import type { UseQueryResult } from '@tanstack/react-query';

export interface QueryShownState {
  /** 結果がまだ 1 度も取れていない間の読み込み中（失敗のあと取り直している間も含む）。 */
  loading: boolean;
  /** 結果が 1 度も取れないまま失敗した。持っている結果の取り直しの失敗は含めない。 */
  failed: boolean;
}

/**
 * queryShownState は、共有の問い合わせの結果を画面の「読み込み中・失敗」に写す。
 *
 * 置き場は画面に戻ったときなどに裏で取り直すので、`isPending` / `isError` / `isFetching` だけで
 * 表示を切り替えると、一時的な失敗や取り直しで出ていた一覧が読み込み中・失敗の表示に隠れる。
 * 読み込み中と失敗を出すのは、結果が 1 度も取れていないときだけにする（shared/README.md の
 * 「サーバーの状態」）。`active` が false（宛先がそろっていない・パネルを閉じている）なら
 * どちらも出さない。
 */
export function queryShownState(result: UseQueryResult<unknown, unknown>, active = true): QueryShownState {
  const missing = result.data === undefined;
  return {
    loading: active && missing && (result.isPending || result.isFetching),
    failed: active && missing && result.isError && !result.isFetching,
  };
}
