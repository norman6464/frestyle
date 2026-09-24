import { useEffect, useState, type RefObject } from 'react';

/**
 * useContainerWidth は要素の幅（px）を追いかける。画面幅ではなく「その要素が置かれた領域の幅」で
 * 見た目を切り替えたいときに使う（隣にパネルが開いて狭くなった一覧など。画面幅の区切り
 * `md:` では、画面は広いのに領域だけ狭い場面を捉えられない）。
 *
 * 測れない環境（ResizeObserver が無い・まだ描かれていない）では null を返す。呼び出し側は
 * null を「広い方の既定」として扱えばよい。
 */
export function useContainerWidth<T extends HTMLElement>(ref: RefObject<T | null>): number | null {
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    setWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}
