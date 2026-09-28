import type { UseQueryResult } from '@tanstack/react-query';
import { getApiError } from '@/shared/lib/classifyApiError';

export interface QueryShownState<T> {
  /** 画面に出してよい結果。見る立場を失ったときや宛先がそろっていないときは undefined。 */
  data: T | undefined;
  /** 結果がまだ 1 度も取れていない間の読み込み中（失敗のあと取り直している間も含む）。 */
  loading: boolean;
  /** 出せる結果が無いまま失敗した（一時的な失敗で持っている結果の取り直しに失敗した場合は含めない）。 */
  failed: boolean;
  /**
   * 失敗が 403・404（見る立場を失った・もう無い）。持っている結果も出さない。取り直しが成功するまで
   * 立てたままにする（取り直している間に、捨てた結果をまた出さない）。
   */
  lostAccess: boolean;
}

/**
 * queryShownState は、共有の問い合わせの結果を画面の「出す結果・読み込み中・失敗」に写す。
 *
 * 置き場は画面に戻ったときなどに裏で取り直すので、`isPending` / `isError` / `isFetching` だけで
 * 表示を切り替えると、一時的な失敗や取り直しで出ていた一覧が読み込み中・失敗の表示に隠れる。
 * 読み込み中と失敗を出すのは、結果が 1 度も取れていないときだけにする（shared/README.md の
 * 「サーバーの状態」）。
 *
 * ただし取り直しが 403・404 で失敗したら、見る立場を失った（権限を外された・消された）ので、
 * 持っている結果も出さずに失敗にする。管理の画面の一覧などが、立場を失ったあとも画面に残らない
 * ように。そのあとの取り直し（再試行・画面に戻ったとき）の間も、成功するまでは出さずに読み込み中に
 * する（置き場は失敗のあとも前の結果を持ち続けるので、取り直している間だけ前の結果がまた見えてしまう）。
 * `active` が false（宛先がそろっていない・パネルを閉じている）なら何も出さない。
 */
export function queryShownState<T>(result: UseQueryResult<T, unknown>, active = true): QueryShownState<T> {
  if (!active) return { data: undefined, loading: false, failed: false, lostAccess: false };
  // 失敗の状態は、取り直しが成功するまで残る（取り直している間も isError のまま）。
  const status = result.isError ? getApiError(result.error).status : undefined;
  const lostAccess = status === 403 || status === 404;
  const data = lostAccess ? undefined : result.data;
  const missing = data === undefined;
  return {
    data,
    loading: missing && (result.isPending || result.isFetching),
    failed: missing && result.isError && !result.isFetching,
    lostAccess,
  };
}
