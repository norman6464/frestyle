import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocalToday } from '../useLocalToday';

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('useLocalToday', () => {
  it('手元の日付を YYYY-MM-DD で返す', () => {
    vi.setSystemTime(new Date(2026, 8, 27, 10, 0, 0));
    const { result } = renderHook(() => useLocalToday());

    expect(result.current).toBe('2026-09-27');
  });

  it('開いたまま日付をまたいだら、翌日に変わる（期限切れの判定を古い日付のまま続けない）', () => {
    vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 30));
    const { result } = renderHook(() => useLocalToday());
    expect(result.current).toBe('2026-09-27');

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(result.current).toBe('2026-09-28');
  });

  it('次の日付もまたげる（1 回で止まらない）', () => {
    vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 30));
    const { result } = renderHook(() => useLocalToday());

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(result.current).toBe('2026-09-28');
    act(() => {
      vi.advanceTimersByTime(24 * 60 * 60 * 1000);
    });

    expect(result.current).toBe('2026-09-29');
  });

  it('鳴ったときに時計が戻されていて日付が同じでも、次の 0 時を予約し直す（止まらない）', () => {
    vi.setSystemTime(new Date(2026, 8, 27, 23, 59, 30));
    const { result } = renderHook(() => useLocalToday());

    // 時計が 1 時間戻された。0 時の予約が鳴っても、まだ 27 日のまま。
    vi.setSystemTime(new Date(2026, 8, 27, 22, 59, 30));
    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });
    expect(result.current).toBe('2026-09-27');

    act(() => {
      vi.advanceTimersByTime(60 * 60 * 1000);
    });

    expect(result.current).toBe('2026-09-28');
  });
});
