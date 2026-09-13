import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import KbTicketSavedFilters from '../KbTicketSavedFilters';
import type { TicketCounts } from '@/entities/ticket';

function renderIt(counts: TicketCounts | null) {
  return render(
    <MemoryRouter>
      <KbTicketSavedFilters spaceId="s-1" counts={counts} />
    </MemoryRouter>,
  );
}

describe('KbTicketSavedFilters', () => {
  it('3つのリンクを、バックログの絞り込みクエリ付きで出す', () => {
    renderIt({ total: 0, assignedToMe: 0, overdue: 0, unassigned: 0 });

    expect(screen.getByRole('link', { name: /自分の担当/ })).toHaveAttribute(
      'href',
      '/kb/backlog/s-1?assignedToMe=1',
    );
    expect(screen.getByRole('link', { name: /期限切れ/ })).toHaveAttribute('href', '/kb/backlog/s-1?overdue=1');
    expect(screen.getByRole('link', { name: /未割り当て/ })).toHaveAttribute(
      'href',
      '/kb/backlog/s-1?unassigned=1',
    );
  });

  it('件数を各リンクに添える', () => {
    renderIt({ total: 10, assignedToMe: 3, overdue: 1, unassigned: 2 });

    expect(screen.getByRole('link', { name: /自分の担当/ })).toHaveTextContent('3');
    expect(screen.getByRole('link', { name: /期限切れ/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /未割り当て/ })).toHaveTextContent('2');
  });

  it('期限切れが 1 件以上のときだけ赤で出す', () => {
    const { unmount } = renderIt({ total: 10, assignedToMe: 0, overdue: 2, unassigned: 0 });
    expect(screen.getByText('2')).toHaveClass('text-red-600');
    unmount();

    renderIt({ total: 10, assignedToMe: 0, overdue: 0, unassigned: 0 });
    expect(screen.getAllByText('0')[1]).not.toHaveClass('text-red-600');
  });

  it('件数がまだ取れていなければ数字を出さず、行だけ出す', () => {
    renderIt(null);

    expect(screen.getByRole('link', { name: '自分の担当' })).toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });
});
