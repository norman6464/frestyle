/**
 * チケットの作成日時・更新日時の表示（例: 2026年6月27日 14:34）。
 *
 * 年を必ず出すのは、バックログには何年も前の行が普通に残るため。「6月27日」だけだと
 * 今年のことだと読み違える。読めない値のときは空文字を返し、行そのものは消さない。
 */
export function formatTicketTimestamp(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${hour}:${minute}`;
}
