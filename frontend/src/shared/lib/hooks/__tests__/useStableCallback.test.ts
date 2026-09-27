import { renderHook } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { useStableCallback } from '../useStableCallback';

describe('useStableCallback', () => {
  it('描き直しても同じ関数を返す（memo の子へ渡しても描き直させない）', () => {
    const { result, rerender } = renderHook(({ n }) => useStableCallback(() => n), { initialProps: { n: 1 } });
    const first = result.current;

    rerender({ n: 2 });

    expect(result.current).toBe(first);
  });

  it('呼ぶと、最後に描いたときの関数を呼ぶ（古い値を読まない）', () => {
    const seen = vi.fn();
    const { result, rerender } = renderHook(({ n }) => useStableCallback((x: string) => seen(n, x)), {
      initialProps: { n: 1 },
    });

    rerender({ n: 2 });
    result.current('押した');

    expect(seen).toHaveBeenCalledWith(2, '押した');
  });

  it('戻り値をそのまま返す', () => {
    const { result } = renderHook(() => useStableCallback((a: number, b: number) => a + b));

    expect(result.current(2, 3)).toBe(5);
  });
});
