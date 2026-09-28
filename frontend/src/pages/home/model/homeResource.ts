import type { UseQueryResult } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';

export type HomeResourceStatus = 'loading' | 'ready' | 'error';

export interface HomeResource<T> {
  data: T;
  status: HomeResourceStatus;
  /** 失敗したときの、その枠だけの再試行。 */
  retry: () => void;
}

/**
 * 共有の問い合わせ（TanStack Query）の結果を、ホームの枠の形に合わせる。ホームの枠はどれも
 * ヘッダーや左の列・ほかの画面と同じ結果を使うので、すべてここを通す。
 *
 * - 前提が揃わず読まない間（enabled: false）と、結果がまだ無い間は loading（失敗のあと
 *   再試行を押して取り直している間も含む）
 * - 失敗を出すのは結果が 1 度も取れていないときだけ。持っている結果は、取り直しの間も・
 *   取り直しに失敗しても出し続ける
 * - 一時的な失敗で、出ていた一覧を消したり失敗の表示に差し替えたりしない（共有の問い合わせは
 *   画面に戻ったときなどに裏で取り直すため）。取り直しが 403・404（見る立場を失った）なら、
 *   持っている結果も出さない（queryShownState）
 */
export function toHomeResource<T>(result: UseQueryResult<T>, initial: T): HomeResource<T> {
  const shown = queryShownState(result);
  const retry = () => void result.refetch();
  if (shown.data !== undefined) return { data: shown.data, status: 'ready', retry };
  return { data: initial, status: shown.failed ? 'error' : 'loading', retry };
}
