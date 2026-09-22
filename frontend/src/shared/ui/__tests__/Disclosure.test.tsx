import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Disclosure from '../Disclosure';

describe('Disclosure', () => {
  it('補助操作は開くまで隠し、Escapeで閉じて起点にフォーカスを戻す', () => {
    render(<Disclosure label="その他"><button>補助操作</button></Disclosure>);
    const trigger = screen.getByRole('button', { name: 'その他' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: '補助操作' })).toBeNull();
    fireEvent.click(trigger);
    const action = screen.getByRole('button', { name: '補助操作' });
    action.focus();
    fireEvent.keyDown(action, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
