import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FieldSelect from '../FieldSelect';

const options = [
  { value: 'todo', label: '未着手' },
  { value: 'doing', label: '進行中' },
  { value: 'done', label: '完了' },
];

describe('FieldSelect', () => {
  it('現在値を名前付きで表示し、選択を通知する', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FieldSelect label="状態" value="todo" options={options} onChange={onChange} />);

    const trigger = screen.getByRole('combobox', { name: '状態' });
    expect(trigger).toHaveTextContent('未着手');
    await user.click(trigger);
    await user.click(screen.getByRole('option', { name: '進行中' }));
    expect(onChange).toHaveBeenCalledWith('doing');
  });

  it('無効化中は選択肢を開かない', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<FieldSelect label="状態" value="todo" options={options} onChange={onChange} disabled />);

    const trigger = screen.getByRole('combobox', { name: '状態' });
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('option', { name: '進行中' })).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
