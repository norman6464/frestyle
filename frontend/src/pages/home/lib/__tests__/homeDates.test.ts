import { describe, expect, it } from 'vitest';
import { formatDueDate, formatViewedAt } from '../homeDates';

describe('homeDates', () => {
  const now = new Date(2026, 8, 24, 12, 0);

  it('最後に開いた日時は今年なら月/日 時:分、それ以外は年を足す', () => {
    // 端末の時刻帯で作った日時を ISO にして渡す（どの時刻帯で走っても同じ答えになる）。
    expect(formatViewedAt(new Date(2026, 8, 19, 10, 5).toISOString(), now)).toBe('9/19 10:05');
    expect(formatViewedAt(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe('2025/12/31 23:59');
  });

  it('期限は今年なら月/日、それ以外は年を足す（時刻帯を持たない日付として読む）', () => {
    expect(formatDueDate('2026-09-20', now)).toBe('9/20');
    expect(formatDueDate('2027-01-05', now)).toBe('2027/1/5');
  });
});
