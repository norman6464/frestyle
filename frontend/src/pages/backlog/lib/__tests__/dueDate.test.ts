import { describe, expect, it } from 'vitest';
import { formatDueDateShort, isOverdue, localTodayISO } from '../dueDate';

describe('dueDate', () => {
  it('ローカル日付を YYYY-MM-DD で返す（月日は 2 桁）', () => {
    expect(localTodayISO(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('今日より前だけを超過とみなす。今日は超過ではない', () => {
    expect(isOverdue('2026-09-21', '2026-09-22')).toBe(true);
    expect(isOverdue('2026-09-22', '2026-09-22')).toBe(false);
    expect(isOverdue('2026-09-23', '2026-09-22')).toBe(false);
  });

  it('未設定は超過ではない', () => {
    expect(isOverdue(null, '2026-09-22')).toBe(false);
  });

  it('一覧用の短い形は先頭の 0 を落とす', () => {
    expect(formatDueDateShort('2026-09-04')).toBe('9/4');
    expect(formatDueDateShort('2026-11-24')).toBe('11/24');
  });
});
