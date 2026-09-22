import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BacklogQuickFilters from '../BacklogQuickFilters';

const counts = { total: 10, assignedToMe: 3, overdue: 1, unassigned: 2 };

describe('BacklogQuickFilters', () => {
  it('「すべて」と 3 つのタブを出し、件数を添える', () => {
    render(<BacklogQuickFilters counts={counts} value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /自分の担当/ })).toHaveTextContent('3');
    expect(screen.getByRole('button', { name: /期限切れ/ })).toHaveTextContent('1');
    expect(screen.getByRole('button', { name: /未割り当て/ })).toHaveTextContent('2');
  });

  it('選ばれているタブだけが押された状態になる', () => {
    render(<BacklogQuickFilters counts={counts} value="overdue" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: /期限切れ/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /自分の担当/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('押すとその種類を通知し、押されているものをもう一度押すと解除になる', () => {
    const onChange = vi.fn();
    const { rerender } = render(<BacklogQuickFilters counts={counts} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /未割り当て/ }));
    expect(onChange).toHaveBeenLastCalledWith('unassigned');

    rerender(<BacklogQuickFilters counts={counts} value="unassigned" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /未割り当て/ }));
    expect(onChange).toHaveBeenLastCalledWith(null);

    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('期限切れが 1 件以上のときだけ赤で出す', () => {
    const { unmount } = render(<BacklogQuickFilters counts={{ ...counts, overdue: 2 }} value={null} onChange={vi.fn()} />);
    // 同じ数字が他のタブにも出ることがあるので、期限切れのボタンの中で探す。
    expect(within(screen.getByRole('button', { name: /期限切れ/ })).getByText('2')).toHaveClass('text-danger-ink');
    expect(within(screen.getByRole('button', { name: /未割り当て/ })).getByText('2')).not.toHaveClass('text-danger-ink');
    unmount();

    render(<BacklogQuickFilters counts={{ ...counts, overdue: 0 }} value={null} onChange={vi.fn()} />);
    expect(within(screen.getByRole('button', { name: /期限切れ/ })).getByText('0')).not.toHaveClass('text-danger-ink');
  });

  it('件数がまだ取れていなければ数字を出さず、タブだけ出す', () => {
    render(<BacklogQuickFilters counts={null} value={null} onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: '自分の担当' })).toBeInTheDocument();
    expect(screen.queryByText(/^\d+$/)).not.toBeInTheDocument();
  });
});
