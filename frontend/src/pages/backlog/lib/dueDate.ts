/**
 * 期限の判定と、日付（'YYYY-MM-DD'）の表示。
 *
 * バックログの日付の出し方はここにまとめる。形は 2 つだけ:
 * - 短い形（9/24）… 一覧の欄やスプリントの期間など、桁を食わせたくない所
 * - 長い形（2026/09/24）… 詳細の項目など、年まで読ませたい所（設計ボードの形）
 * 以前は一覧・スプリントの段・設定・詳細で 4 通りの書き方が混ざっていた。
 *
 * 期限は 'YYYY-MM-DD' の文字列で、時刻もタイムゾーンも持たない「その日」。比較も文字列の
 * まま行う（同じ形なら辞書順 = 日付順）。Date に変換すると UTC 解釈で前日にずれることがある。
 */

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 端末のローカル日付を 'YYYY-MM-DD' で返す。テストから差し替えられるよう引数で受ける。 */
export function localTodayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** 期限が今日より前か。未設定（null）は超過ではない。 */
export function isOverdue(dueDate: string | null, today: string): boolean {
  return dueDate !== null && dueDate < today;
}

/** 一覧の欄に出す短い形（9/24）。年は出さない —— 同じ年の中で捌くのが普通で、桁を食うだけ。 */
export function formatDueDateShort(dueDate: string): string {
  const [, m, d] = dueDate.split('-');
  return `${Number(m)}/${Number(d)}`;
}

/** 詳細の項目に出す長い形（2026/09/24）。'YYYY-MM-DD' でない値はそのまま返す。 */
export function formatDateLong(date: string): string {
  const [y, m, d] = date.split('-');
  if (!y || !m || !d) return date;
  return `${y}/${m}/${d}`;
}

/**
 * 期間を短い形で「開始 〜 終了」にする。片方だけでも出し、無い側は「未定」。
 * 両方無ければ空文字（呼び出し側が「日付を追加」などを出す）。
 */
export function formatPeriodShort(start?: string | null, end?: string | null): string {
  const s = start ? formatDueDateShort(start) : '';
  const e = end ? formatDueDateShort(end) : '';
  if (!s && !e) return '';
  return `${s || '未定'} 〜 ${e || '未定'}`;
}
