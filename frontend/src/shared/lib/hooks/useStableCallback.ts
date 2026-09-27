import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * useStableCallback は、描き直しても同じ関数を返し、呼ばれたときに最後に描いたときの関数を呼ぶ。
 *
 * memo の子（一覧の行など）へ渡す操作に使う。useCallback だと、中で使う値（URL の状態・
 * 取得の hook が返す関数）が変わるたびに作り直され、全行を描き直してしまう。
 *
 * **描いている途中で呼ばない**（イベントの中だけで呼ぶ）。中身の差し替えは描き終えた直後に
 * 行うので、描いている途中で呼ぶと 1 つ前の関数を呼ぶ。effect の中から呼ぶだけなら
 * React の useEffectEvent を使う。
 */
export function useStableCallback<Args extends unknown[], Result>(
  fn: (...args: Args) => Result,
): (...args: Args) => Result {
  const latest = useRef(fn);
  useLayoutEffect(() => {
    latest.current = fn;
  });
  return useCallback((...args: Args) => latest.current(...args), []);
}
