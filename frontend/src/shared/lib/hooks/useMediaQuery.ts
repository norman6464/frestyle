import { useEffect, useState } from 'react';

/**
 * useMediaQuery はメディアクエリが今当たっているかを返す。
 *
 * 見た目の出し分けは CSS で足りるが、**役割の名乗り**（狭い画面の引き出しだけ dialog を名乗る）
 * や、幅で振る舞いを変える処理は JS で知る必要がある。matchMedia の無い環境（単体テストの
 * jsdom）では false（広い画面扱い）。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
