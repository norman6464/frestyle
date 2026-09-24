/**
 * ホームの日時の書き方。見本（マイホーム）の「9/19 10:35」「期限 9/20」にそろえ、今年でなければ
 * 年を足す（去年の同じ日付と取り違えないため）。利用者の端末の時刻帯で書く。
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 最後に開いた日時（ISO 8601）。今年なら「9/19 10:35」、それ以外は「2025/9/19 10:35」。 */
export function formatViewedAt(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const date = at.getFullYear() === now.getFullYear()
    ? `${at.getMonth() + 1}/${at.getDate()}`
    : `${at.getFullYear()}/${at.getMonth() + 1}/${at.getDate()}`;
  return `${date} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

/** 期限（'YYYY-MM-DD'。時刻帯を持たない日付）。今年なら「9/20」、それ以外は「2027/1/5」。 */
export function formatDueDate(date: string, now: Date = new Date()): string {
  const [y, m, d] = date.split('-').map(Number);
  return y === now.getFullYear() ? `${m}/${d}` : `${y}/${m}/${d}`;
}
