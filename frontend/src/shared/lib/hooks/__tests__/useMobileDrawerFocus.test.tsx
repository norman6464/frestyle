import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMobileDrawerFocus } from '../useMobileDrawerFocus';

function Example() {
  const [open, setOpen] = useState(false);
  const ref = useMobileDrawerFocus(open, () => setOpen(false));
  return <><button onClick={() => setOpen(true)}>開く</button>{open && <div ref={ref} tabIndex={-1}><button>最初</button><a href="#last">最後</a></div>}</>;
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useMobileDrawerFocus', () => {
  it('モバイルではTabが循環し、Escapeで閉じると起点に戻る', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([{}] as unknown as DOMRectList);
    render(<Example />);
    const trigger = screen.getByRole('button', { name: '開く' });
    trigger.focus();
    fireEvent.click(trigger);
    const first = screen.getByRole('button', { name: '最初' });
    const last = screen.getByRole('link', { name: '最後' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(first).toHaveFocus();
    fireEvent.keyDown(first, { key: 'Escape' });
    expect(screen.queryByRole('button', { name: '最初' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('広い画面ではフォーカスを奪わない', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<Example />);
    const trigger = screen.getByRole('button', { name: '開く' });
    trigger.focus();
    fireEvent.click(trigger);
    expect(trigger).toHaveFocus();
  });
});
