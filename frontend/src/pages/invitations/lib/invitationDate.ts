function valid(iso: string): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** 招待日時（設計ボード ST15 の「2026/09/18 09:30」）。壊れた値は空文字。 */
export function formatInvitationDateTime(iso: string): string {
  const date = valid(iso);
  if (!date) return '';
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 期限（「9月30日」）。壊れた値は空文字。 */
export function formatInvitationDeadline(iso: string): string {
  const date = valid(iso);
  if (!date) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
