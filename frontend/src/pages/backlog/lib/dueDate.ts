/**
 * 期限の判定と表示。
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
