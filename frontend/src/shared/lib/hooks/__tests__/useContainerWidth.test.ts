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
    // ref は描画をまたいで同じ物を渡す（呼び出し側の useRef と同じ）。毎回作り直すと、
    // 描画のたびに観測を張り直して最初の幅を測り直してしまう。
    const ref = { current: elementOfWidth(900) };
    const { result, unmount } = renderHook(() => useContainerWidth(ref));
    expect(result.current).toBe(900);

    act(() => observers[0].callback([{ contentRect: { width: 520 } }]));
    expect(result.current).toBe(520);

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });
});
