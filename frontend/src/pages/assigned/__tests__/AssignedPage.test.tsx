import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AssignedTicket } from '@/entities/ticket';
import AssignedPage from '../ui/AssignedPage';
import { useAssignedTickets } from '../model/useAssignedTickets';

vi.mock('../model/useAssignedTickets', () => ({ useAssignedTickets: vi.fn() }));

const ticket: AssignedTicket = {
  id: 'ticket-1', projectId: 'project-1', projectKey: 'APP', projectName: 'アプリ開発',
  number: 12, title: 'ログイン画面の動作を確認する', typeName: 'タスク',
  statusName: '進行中', statusCategory: 'in_progress', statusColor: '#d4c5a0',
  priority: 1, dueDate: '2026-09-20',
};

function renderPage() {
  return render(<MemoryRouter><AssignedPage /></MemoryRouter>);
}

describe('AssignedPage', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 8, 21, 12));
    vi.mocked(useAssignedTickets).mockReturnValue({
      groups: [], total: 0, loading: false, error: null, reload: vi.fn(),
    });
  });

  afterEach(() => vi.useRealTimers());

  it('担当数と期限を確認でき、状態ごとの順序とチケットへのリンクを保つ', () => {
    vi.mocked(useAssignedTickets).mockReturnValue({
      groups: [
        { name: '進行中', category: 'in_progress', color: '#d4c5a0', tickets: [
          ticket,
          { ...ticket, id: 'ticket-2', number: 13, title: 'APIを確認する', dueDate: '2026-09-21', priority: 0 },
        ] },
        { name: '完了', category: 'done', color: '#d4c5a0', tickets: [
          { ...ticket, id: 'ticket-3', title: '完了した作業', statusName: '完了', statusCategory: 'done' },
        ] },
      ], total: 3, loading: false, error: null, reload: vi.fn(),
    });
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: '自分の担当' })).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: '担当の概要' });
    expect(within(summary).getByText('担当チケット').nextElementSibling).toHaveTextContent('3件');
    expect(within(summary).getByText('期限超過').nextElementSibling).toHaveTextContent('1件');
    expect(within(summary).getByText('今日が期限').nextElementSibling).toHaveTextContent('1件');
    const list = screen.getByRole('list', { name: '進行中のチケット' });
    expect(within(list).getAllByRole('link').map((link) => link.getAttribute('href')))
      .toEqual(['/tickets/ticket-1', '/tickets/ticket-2']);
    const row = within(list).getByRole('link', { name: /ログイン画面の動作を確認する/ });
    expect(row).toHaveTextContent('優先度 高');
    expect(row).toHaveTextContent('期限超過');
    expect(row).toHaveTextContent('アプリ開発');
    expect(screen.getByRole('link', { name: /完了した作業/ })).not.toHaveTextContent('期限超過');
  });

  it('担当が空ならバックログへの入口を表示する', () => {
    renderPage();
    expect(screen.getByText('担当しているチケットはありません')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'バックログを開く' })).toHaveAttribute('href', '/backlog');
  });

  it('読み込み中は見出しを残し、0件と断定しない', () => {
    vi.mocked(useAssignedTickets).mockReturnValue({ groups: [], total: 0, loading: true, error: null, reload: vi.fn() });
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: '自分の担当' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: '担当の概要' })).not.toBeInTheDocument();
    expect(screen.queryByText('担当しているチケットはありません')).not.toBeInTheDocument();
  });

  it('取得に失敗したら空状態と区別し、その場で再試行できる', () => {
    const reload = vi.fn();
    vi.mocked(useAssignedTickets).mockReturnValue({
      groups: [], total: 0, loading: false, error: '担当の一覧を取得できませんでした。', reload,
    });
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('担当の一覧を取得できませんでした。');
    expect(screen.queryByText('担当しているチケットはありません')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再試行' }));
    expect(reload).toHaveBeenCalledOnce();
  });
});
