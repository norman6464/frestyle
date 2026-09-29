import { describe, expect, it } from 'vitest';
import { formatDueDate } from '../homeDates';

describe('homeDates', () => {
  const now = new Date(2026, 8, 24, 12, 0);

  it('期限は今年なら月/日、それ以外は年を足す（時刻帯を持たない日付として読む）', () => {
    expect(formatDueDate('2026-09-20', now)).toBe('9/20');
    expect(formatDueDate('2027-01-05', now)).toBe('2027/1/5');
  });
});
