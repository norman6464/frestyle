import { useCallback, useEffect, useState } from 'react';

export type HomeResourceStatus = 'loading' | 'ready' | 'error';

export interface HomeResource<T> {
  data: T;
  status: HomeResourceStatus;
  /** 失敗したときの、その枠だけの再試行。 */
  retry: () => void;
}

/**
 * ホームの枠 1 つ分の取得。枠ごとに独立して読み、1 つの失敗でほかの枠を隠さない。
 *
 * - 鍵（key）が変わったら前の結果を捨てて読み直す。古い応答は signal で捨てる
 *   （ワークスペースを切り替えた直後に、前のワークスペースのお気に入りを新しい名前の下に出さない）
 * - 失敗したら前の結果を残さない（見られなくなったものを表示し続けない）。0 件とは区別して
 *   status を error にする
 * - key が null の間は読まない（読む前提がまだ揃っていない）。data は初期値のまま loading
 */
export function useHomeResource<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
  initial: T,
): HomeResource<T> {
  const [data, setData] = useState<T>(initial);
  const [status, setStatus] = useState<HomeResourceStatus>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setData(initial);
    setStatus('loading');
    if (key === null) return undefined;
    const controller = new AbortController();
    load(controller.signal)
      .then((next) => {
        if (controller.signal.aborted) return;
        setData(next);
        setStatus('ready');
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        setData(initial);
        setStatus('error');
      });
    return () => controller.abort();
    // load と initial は呼び出し側で毎回作られる。読み直しの引き金は key と再試行だけにする。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { data, status, retry };
}
