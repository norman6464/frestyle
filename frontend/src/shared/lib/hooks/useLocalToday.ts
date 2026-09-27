import { useEffect, useState } from 'react';

function localDateString(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * useLocalToday は手元の「今日」（YYYY-MM-DD）を返し、日付が変わったら更新する。
 *
 * 描いている途中で `new Date()` から求めると、React Compiler は入力の無い計算として 1 回しか
 * 行わず、画面を開いたまま日付をまたぐと古い日付のまま（期限切れの判定がずれる）になる。
 * state に持ち、次の 0 時に取り直す。
 */
export function useLocalToday(): string {
  const [today, setToday] = useState(() => localDateString(new Date()));
  useEffect(() => {
    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    // 0 時ちょうどに撃つと時計の揺れで前の日のまま取り直すことがあるので、少し後にする。
    const timer = setTimeout(() => setToday(localDateString(new Date())), nextMidnight.getTime() - now.getTime() + 1000);
    return () => clearTimeout(timer);
  }, [today]);
  return today;
}
