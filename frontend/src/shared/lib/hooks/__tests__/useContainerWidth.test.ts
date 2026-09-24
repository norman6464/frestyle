import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useContainerWidth } from '../useContainerWidth';

type Callback = (entries: { contentRect: { width: number } }[]) => void;

function stubResizeObserver() {
  const observers: { callback: Callback; disconnect: ReturnType<typeof vi.fn> }[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: Callback;
      disconnect = vi.fn();
      constructor(callback: Callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe() {}
    },
  );
  return observers;
}

function elementOfWidth(width: number): HTMLDivElement {
  const element = document.createElement('div');
  element.getBoundingClientRect = () => ({ width }) as DOMRect;
  return element;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useContainerWidth', () => {
  it('要素が無ければ null（呼び出し側は広い方の既定として扱う）', () => {
    stubResizeObserver();
    const { result } = renderHook(() => useContainerWidth({ current: null }));
    expect(result.current).toBeNull();
  });

  it('ResizeObserver が無い環境では null', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { result } = renderHook(() => useContainerWidth({ current: elementOfWidth(500) }));
    expect(result.current).toBeNull();
  });

  it('最初の幅を測り、変わるたびに追いかけ、外れたら観測をやめる', () => {
    const observers = stubResizeObserver();
    const { result, unmount } = renderHook(() => useContainerWidth({ current: elementOfWidth(900) }));
    expect(result.current).toBe(900);

    act(() => observers[0].callback([{ contentRect: { width: 520 } }]));
    expect(result.current).toBe(520);

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });
});
