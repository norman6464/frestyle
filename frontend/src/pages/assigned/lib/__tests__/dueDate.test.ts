import { describe, expect, it } from 'vitest';
import type { AssignedTicket } from '@/entities/ticket';
import { dueDateLabel, dueState, localToday } from '../dueDate';

const ticket: AssignedTicket = {
  id: 't1', projectId: 'p1', projectKey: 'APP', projectName: 'アプリ開発', number: 1,
  title: '設計を確認する', typeName: 'タスク', statusName: '進行中', statusCategory: 'in_progress',
  statusColor: '#777777', priority: 0, dueDate: null,
};

describe('担当チケットの期限表示', () => {
  it('ローカルの日付をゼロ埋めし、深夜もその日を使う', () => {
    expect(localToday(new Date(2026, 0, 2, 0, 1))).toBe('2026-01-02');
  });

  it.each([
    [null, 'in_progress', 'none'],
    ['2026-09-20', 'in_progress', 'overdue'],
    ['2026-09-21', 'todo', 'today'],
    ['2026-09-22', 'todo', 'scheduled'],
    ['2026-09-20', 'done', 'scheduled'],
    ['2026-09-21', 'done', 'scheduled'],
  ] as const)('期限 %s・状態 %s は %s', (dueDate, statusCategory, expected) => {
    expect(dueState({ ...ticket, dueDate, statusCategory }, '2026-09-21')).toBe(expected);
  });

  it('違う年の期限は年を省略しない', () => {
    expect(dueDateLabel('2027-01-02', '2026-09-21')).toBe('2027/1/2');
    expect(dueDateLabel('2026-09-22', '2026-09-21')).toBe('9/22');
  });
});
