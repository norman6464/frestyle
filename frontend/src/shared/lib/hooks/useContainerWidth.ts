import { useCallback, useEffect, useState } from 'react';

/**
 * useContainerWidth は要素の幅（px）を追いかける。画面幅ではなく「その要素が置かれた領域の幅」で
 * 見た目を切り替えたいときに使う（隣にパネルが開いて狭くなった一覧など。画面幅の区切り
 * `md:` では、画面は広いのに領域だけ狭い場面を捉えられない）。
 *
 * 返すのは callback ref と幅の組。ref オブジェクトにしないのは、測る要素が後から描かれたり
 * （読み込み中・0 件の表示から一覧へ変わる）作り直されたりしたときに、観測を張り直すため
 * （ref オブジェクトの中身の差し替えは effect を動かさない）。
 *
 * 測れない環境（ResizeObserver が無い・まだ描かれていない）では幅は null。呼び出し側は
 * null を「広い方の既定」として扱えばよい。
 */
export function useContainerWidth<T extends HTMLElement>(): [(node: T | null) => void, number | null] {
  const [element, setElement] = useState<T | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  return [ref, width];
}
