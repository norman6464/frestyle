import { describe, expect, it } from 'vitest';
import { formatDateLong, formatDueDateShort, formatPeriodShort, isOverdue, localTodayISO } from '../dueDate';

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

describe('formatDateLong', () => {
  it('詳細の項目は年まで入れた長い形（設計ボードの 2026/09/24）', () => {
    expect(formatDateLong('2026-09-24')).toBe('2026/09/24');
  });

  it('形の違う値はそのまま返す（壊れた値を別の日付に見せない）', () => {
    expect(formatDateLong('2026-09')).toBe('2026-09');
  });
});

describe('formatPeriodShort', () => {
  it('期間は短い形で「開始 〜 終了」', () => {
    expect(formatPeriodShort('2026-09-01', '2026-09-14')).toBe('9/1 〜 9/14');
  });

  it('片方だけなら無い側を「未定」にする', () => {
    expect(formatPeriodShort('2026-09-01', null)).toBe('9/1 〜 未定');
    expect(formatPeriodShort(undefined, '2026-09-14')).toBe('未定 〜 9/14');
  });

  it('両方無ければ空文字', () => {
    expect(formatPeriodShort(null, null)).toBe('');
  });
});
