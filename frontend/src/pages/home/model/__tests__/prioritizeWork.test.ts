import { describe, expect, it } from 'vitest';
import type { AssignedTicket } from '@/entities/ticket';
import { prioritizeWork } from '../prioritizeWork';

const ticket = (id: string, statusCategory = 'todo', dueDate: string | null = null): AssignedTicket => ({
  id, statusCategory, dueDate, projectId: 'p', projectKey: 'TEST', projectName: 'テスト', number: 1,
  title: id, typeName: 'タスク', statusName: '状態', statusColor: '#2563eb', priority: 2,
});
describe('prioritizeWork', () => {
  it('未完了のみを期限超過・今日・進行中の順に並べ、元データは変更しない', () => {
    const data = [ticket('later'), ticket('active', 'in_progress'), ticket('today', 'todo', '2026-09-22'), ticket('late', 'todo', '2026-09-21'), ticket('done', 'done', '2026-09-01')];
    expect(prioritizeWork(data, '2026-09-22').map((t) => t.id)).toEqual(['late', 'today', 'active', 'later']);
    expect(data[0].id).toBe('later');
  });
  it('同じ区分では期限が近い順、期限が同じなら優先度順にする', () => {
    const a = ticket('a', 'todo', '2026-09-24');
    const b = { ...ticket('b', 'todo', '2026-09-24'), priority: 1 };
    expect(prioritizeWork([a, ticket('none'), b, ticket('first', 'todo', '2026-09-23')], '2026-09-22').map((t) => t.id)).toEqual(['first', 'b', 'a', 'none']);
  });
});
