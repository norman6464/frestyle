import type { AssignedTicket } from '@/entities/ticket';

/** 日付だけの期限は UTC に変換せず、利用者のローカル日付で比較する。 */
export function localToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function dueState(ticket: AssignedTicket, today: string): 'overdue' | 'today' | 'scheduled' | 'none' {
  if (!ticket.dueDate) return 'none';
  if (ticket.statusCategory === 'done') return 'scheduled';
  if (ticket.dueDate < today) return 'overdue';
  return ticket.dueDate === today ? 'today' : 'scheduled';
}

export function dueDateLabel(date: string, today: string): string {
  const [year, month, day] = date.split('-');
  if (!year || !month || !day) return date;
  const prefix = year === today.slice(0, 4) ? '' : `${year}/`;
  return `${prefix}${Number(month)}/${Number(day)}`;
}
