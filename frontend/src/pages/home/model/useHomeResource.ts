import { useCallback, useEffect, useState } from 'react';

export type HomeResourceStatus = 'loading' | 'ready' | 'error';

export interface HomeResource<T> {
  data: T;
  status: HomeResourceStatus;
  /** 失敗したときの、その枠だけの再試行。 */
  retry: () => void;
}

interface Loaded<T> {
  key: string | null;
  attempt: number;
  data: T;
  status: 'ready' | 'error';
}

/**
 * ホームの枠 1 つ分の取得。枠ごとに独立して読み、1 つの失敗でほかの枠を隠さない。
 *
 * - 結果は「どの鍵・何回目の読み込みの結果か」と一緒に持ち、今の鍵と違う結果は使わない。
 *   鍵が変わった直後の描画でも前の結果を出さない（ワークスペースを切り替えた直後に、前の
 *   ワークスペースのお気に入りやスペースを新しい名前の下に出したり、それを元に選んだりしない）
 * - 古い応答は signal で捨てる
 * - 失敗したら前の結果を残さない（見られなくなったものを表示し続けない）。0 件とは区別して
 *   status を error にする
 * - key が null の間は読まない（読む前提がまだ揃っていない）。data は初期値のまま loading
 */
export function useHomeResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  initial: T,
): HomeResource<T> {
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);

  useEffect(() => {
    if (key === null) return undefined;
    const controller = new AbortController();
    load(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setLoaded({ key, attempt, data, status: 'ready' });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoaded({ key, attempt, data: initial, status: 'error' });
      });
    return () => controller.abort();
    // load と initial は呼び出し側で毎回作られる。読み直しの引き金は key と再試行だけにする。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const current = loaded !== null && key !== null && loaded.key === key && loaded.attempt === attempt ? loaded : null;
  return current ? { data: current.data, status: current.status, retry } : { data: initial, status: 'loading', retry };
}
