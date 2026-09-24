import { useRef, useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useDismissOnOutside } from '../useDismissOnOutside';

/** 引き金とポップアップが兄弟で、1 つの枠に包まれていない形（実際のメニューと同じ）。 */
function Example({ onDismiss, returnFocus = false }: { onDismiss: () => void; returnFocus?: boolean }) {
  const [open, setOpen] = useState(true);
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  useDismissOnOutside(
    open,
    [trigger, popup],
    () => {
      setOpen(false);
      onDismiss();
    },
    returnFocus ? { returnFocus: trigger } : {},
  );
  return (
    <>
      <button ref={trigger} type="button" onClick={() => setOpen((prev) => !prev)}>
        引き金
      </button>
      <button type="button">外のボタン</button>
      {open && (
        <div ref={popup} role="menu">
          <input aria-label="名前" />
        </div>
      )}
    </>
  );
}

describe('useDismissOnOutside', () => {
  it('外を押すと閉じる', () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: '外のボタン' }));
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('引き金やポップアップの中を押しても閉じない', () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    fireEvent.mouseDown(screen.getByRole('button', { name: '引き金' }));
    fireEvent.mouseDown(screen.getByRole('textbox', { name: '名前' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('Escape で閉じる', () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: '名前' }), { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('日本語入力の変換中の Escape では閉じない（打ちかけの文字を守る）', () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    const input = screen.getByRole('textbox', { name: '名前' });
    fireEvent.keyDown(input, { key: 'Escape', isComposing: true });
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('閉じているあいだは外を押しても何も起きない（リスナーを外している）', () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    fireEvent.mouseDown(document.body);
    fireEvent.mouseDown(document.body);
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('閉じたあと開き直せば、また外で閉じられる', () => {
    const onDismiss = vi.fn();
    render(<Example onDismiss={onDismiss} />);
    fireEvent.mouseDown(document.body);
    fireEvent.click(screen.getByRole('button', { name: '引き金' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  describe('閉じたあとのフォーカス', () => {
    it('中にフォーカスがあるまま Escape で閉じたら、引き金へ戻す（行き先が消えて body に落ちない）', () => {
      render(<Example onDismiss={vi.fn()} returnFocus />);
      const input = screen.getByRole('textbox', { name: '名前' });
      input.focus();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.getByRole('button', { name: '引き金' })).toHaveFocus();
    });

    it('外を押して閉じたときは戻さない（押した先へ移るのが自然）', () => {
      render(<Example onDismiss={vi.fn()} returnFocus />);
      screen.getByRole('textbox', { name: '名前' }).focus();
      const outside = screen.getByRole('button', { name: '外のボタン' });
      fireEvent.mouseDown(outside);
      outside.focus();
      expect(outside).toHaveFocus();
    });

    it('フォーカスがポップアップの外の別の場所にあるときの Escape では奪わない', () => {
      render(<Example onDismiss={vi.fn()} returnFocus />);
      const outside = screen.getByRole('button', { name: '外のボタン' });
      outside.focus();
      fireEvent.keyDown(outside, { key: 'Escape' });
      expect(outside).toHaveFocus();
    });

    it('returnFocus を渡さなければ動かさない', () => {
      render(<Example onDismiss={vi.fn()} />);
      const input = screen.getByRole('textbox', { name: '名前' });
      input.focus();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect(screen.getByRole('button', { name: '引き金' })).not.toHaveFocus();
    });
  });
});
