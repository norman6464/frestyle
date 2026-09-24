import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useContainerWidth } from '../useContainerWidth';

type Callback = (entries: { contentRect: { width: number } }[]) => void;

interface FakeObserver {
  callback: Callback;
  observed: Element[];
  disconnect: ReturnType<typeof vi.fn>;
}

function stubResizeObserver() {
  const observers: FakeObserver[] = [];
  vi.stubGlobal(
    'ResizeObserver',
    class {
      callback: Callback;
      observed: Element[] = [];
      disconnect = vi.fn();
      constructor(callback: Callback) {
        this.callback = callback;
        observers.push(this);
      }
      observe(element: Element) {
        this.observed.push(element);
      }
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
  it('要素が付くまでは null（呼び出し側は広い方の既定として扱う）', () => {
    stubResizeObserver();
    const { result } = renderHook(() => useContainerWidth<HTMLDivElement>());
    expect(result.current[1]).toBeNull();
  });

  it('ResizeObserver が無い環境では null', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { result } = renderHook(() => useContainerWidth<HTMLDivElement>());
    act(() => result.current[0](elementOfWidth(500)));
    expect(result.current[1]).toBeNull();
  });

  it('要素が付いたら幅を測り、変わるたびに追いかけ、外れたら観測をやめる', () => {
    const observers = stubResizeObserver();
    const { result, unmount } = renderHook(() => useContainerWidth<HTMLDivElement>());
    act(() => result.current[0](elementOfWidth(900)));
    expect(result.current[1]).toBe(900);

    act(() => observers[0].callback([{ contentRect: { width: 520 } }]));
    expect(result.current[1]).toBe(520);

    unmount();
    expect(observers[0].disconnect).toHaveBeenCalled();
  });

  it('要素が作り直されたら、古い要素の観測をやめて新しい要素を測り直す', () => {
    const observers = stubResizeObserver();
    const { result } = renderHook(() => useContainerWidth<HTMLDivElement>());
    const first = elementOfWidth(900);
    act(() => result.current[0](first));
    expect(observers[0].observed).toEqual([first]);

    // 一覧が 0 件の表示に替わって要素が外れ、また一覧へ戻って別の要素が付く。
    act(() => result.current[0](null));
    expect(observers[0].disconnect).toHaveBeenCalled();
    const second = elementOfWidth(520);
    act(() => result.current[0](second));
    expect(result.current[1]).toBe(520);
    expect(observers[1].observed).toEqual([second]);
  });
});
