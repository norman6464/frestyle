import { useCallback, useState } from 'react';

/**
 * useContainerNarrowerThan は、要素の幅が minWidth より狭いかどうかを返す。画面幅ではなく
 * 「その要素が置かれた領域の幅」で見た目を切り替えたいときに使う（隣にパネルが開いて狭く
 * なった一覧など。画面幅の区切り `md:` では、画面は広いのに領域だけ狭い場面を捉えられない）。
 *
 * **境目をまたいだときだけ state が変わる**。幅そのものを state にすると、隣のパネルの幅を
 * ドラッグで変えるたびに（1px ごとに）一覧全体を描き直す。
 *
 * 返すのは callback ref と真偽の組。ref オブジェクトにしないのは、測る要素が後から描かれたり
 * （読み込み中・0 件の表示から一覧へ変わる）作り直されたりしたときに、観測を張り直すため。
 * 後片付けは callback ref が返す関数（React 19）で行う。
 *
 * 測れない環境（ResizeObserver が無い・まだ描かれていない）では null。呼び出し側は null を
 * 「広い方の既定」として扱えばよい。
 */
export function useContainerNarrowerThan<T extends HTMLElement>(
  minWidth: number,
): [(node: T | null) => (() => void) | undefined, boolean | null] {
  const [narrow, setNarrow] = useState<boolean | null>(null);
  const ref = useCallback(
    (node: T | null) => {
      if (!node || typeof ResizeObserver === 'undefined') return undefined;
      // 同じ値で state を書いても、React は部品を 1 回呼んでから止めることがある。前の値を覚えて、
      // 変わったときだけ書く。
      let last: boolean | null = null;
      const measure = (width: number) => {
        const next = width < minWidth;
        if (next === last) return;
        last = next;
        setNarrow(next);
      };
      measure(node.getBoundingClientRect().width);
      const observer = new ResizeObserver((entries) => {
        for (const entry of entries) measure(entry.contentRect.width);
      });
      observer.observe(node);
      return () => observer.disconnect();
    },
    [minWidth],
  );
  return [ref, narrow];
}
