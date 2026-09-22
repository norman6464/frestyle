import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AutoResizeTextarea from '../AutoResizeTextarea';

describe('AutoResizeTextarea', () => {
  it('外部更新と入力を扱い、複数行の題名を表示できる', () => {
    const onChange = vi.fn();
    const { rerender } = render(<AutoResizeTextarea aria-label="題名" value="短い題名" onChange={onChange} />);
    const input = screen.getByRole('textbox', { name: '題名' });
    Object.defineProperty(input, 'scrollHeight', { configurable: true, value: 96 });
    rerender(<AutoResizeTextarea aria-label="題名" value="とても長い題名" onChange={onChange} />);
    expect(input).toHaveValue('とても長い題名');
    expect(input).toHaveStyle({ height: '96px' });
    fireEvent.change(input, { target: { value: '編集した題名' } });
    expect(onChange).toHaveBeenCalledOnce();
  });
});
