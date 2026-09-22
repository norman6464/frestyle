import type { AssignedTicket } from '@/entities/ticket';

export function workToday(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** ホームのプレビュー順。バックログの手動順やAPIデータは変更しない。 */
export function prioritizeWork(tickets: AssignedTicket[], today: string): AssignedTicket[] {
  const rank = (t: AssignedTicket) => t.dueDate && t.dueDate < today ? 0 : t.dueDate === today ? 1 : t.statusCategory === 'in_progress' ? 2 : 3;
  return tickets.filter((t) => t.statusCategory !== 'done').sort((a, b) =>
    rank(a) - rank(b) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || a.priority - b.priority,
  );
}
