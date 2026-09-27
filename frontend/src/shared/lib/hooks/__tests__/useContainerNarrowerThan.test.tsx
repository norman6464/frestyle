import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useContainerNarrowerThan } from '../useContainerNarrowerThan';

type Callback = (entries: { contentRect: { width: number } }[]) => void;

function stubResizeObserver(initialWidth: number) {
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
      observe(element: Element) {
        (element as HTMLElement).getBoundingClientRect = () => ({ width: initialWidth }) as DOMRect;
      }
    },
  );
  // 付いた直後の幅は getBoundingClientRect で測る。observe より前に呼ばれても同じ値を返す。
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ width: initialWidth } as DOMRect);
  return observers;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Probe({ onRender }: { onRender: (narrow: boolean | null) => void }) {
  const [ref, narrow] = useContainerNarrowerThan<HTMLDivElement>(600);
  onRender(narrow);
  return <div ref={ref} />;
}

describe('useContainerNarrowerThan', () => {
  it('付いた直後の幅で決める', () => {
    stubResizeObserver(500);
    const seen: (boolean | null)[] = [];
    render(<Probe onRender={(n) => seen.push(n)} />);

    expect(seen.at(-1)).toBe(true);
  });

  it('境目をまたがない幅の変化では描き直さない', () => {
    const observers = stubResizeObserver(800);
    const seen: (boolean | null)[] = [];
    render(<Probe onRender={(n) => seen.push(n)} />);
    const before = seen.length;

    act(() => {
      observers[0].callback([{ contentRect: { width: 780 } }]);
      observers[0].callback([{ contentRect: { width: 700 } }]);
    });

    expect(seen.length).toBe(before);
    expect(seen.at(-1)).toBe(false);
  });

  it('境目をまたいだら切り替わる', () => {
    const observers = stubResizeObserver(800);
    const seen: (boolean | null)[] = [];
    render(<Probe onRender={(n) => seen.push(n)} />);

    act(() => {
      observers[0].callback([{ contentRect: { width: 590 } }]);
    });

    expect(seen.at(-1)).toBe(true);
  });

  it('ResizeObserver が無い環境では null（呼び出し側は広い方の既定として扱う）', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const seen: (boolean | null)[] = [];
    render(<Probe onRender={(n) => seen.push(n)} />);

    expect(seen.at(-1)).toBeNull();
  });

  it('外れたら観測をやめる', () => {
    const observers = stubResizeObserver(800);
    const { unmount } = render(<Probe onRender={() => {}} />);

    unmount();

    expect(observers[0].disconnect).toHaveBeenCalled();
  });
});
