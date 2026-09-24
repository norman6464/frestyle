import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../ui/HomePage';
import KbRepository from '@/entities/kb/api/kbRepository';
import TicketRepository from '@/entities/ticket/api/ticketRepository';
import { NotificationRepository } from '@/entities/notification/api/notificationRepository';
import ProfileRepository from '@/entities/user/api/profileRepository';
import { createMockStorage } from '@/test/mockStorage';

const workspace = { slug: 'team-a', name: '開発チーム', createdAt: '', canManage: false, canCreateTickets: true };

const recentPage = {
  pageId: 'page-1',
  workspaceSlug: 'team-a',
  title: '設計メモ',
  spaceId: 'space-1',
  spaceName: '開発ノート',
  viewedAt: '2026-09-20T09:00:00.000Z',
};

const assignedTicket = {
  id: 't1',
  workspaceSlug: 'team-a',
  workspaceName: '開発チーム',
  projectId: 'p1',
  projectKey: 'APP',
  projectName: 'FreStyle',
  number: 24,
  title: '初めての人が迷わず参加できる導線にする',
  typeName: '改善',
  statusName: '進行中',
  statusCategory: 'in_progress',
  statusColor: '#2563eb',
  priority: 1,
  dueDate: '2026-09-30',
};

function renderHome() {
  return render(
    <MemoryRouter>
      <HomePage />
    </MemoryRouter>,
  );
}

// jsdom には matchMedia が無いので、ホームは狭い画面（1 列・初めは 2 件）として描かれる。
describe('HomePage', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMockStorage());
    vi.spyOn(KbRepository, 'fetchWorkspaces').mockResolvedValue([workspace]);
    vi.spyOn(KbRepository, 'fetchRecentPages').mockResolvedValue([]);
    vi.spyOn(KbRepository, 'fetchFavorites').mockResolvedValue([]);
    vi.spyOn(TicketRepository, 'fetchMyAssignedTickets').mockResolvedValue([]);
    vi.spyOn(TicketRepository, 'fetchPageTicketReferences').mockResolvedValue([]);
    vi.spyOn(NotificationRepository, 'getUnreadCount').mockResolvedValue(0);
    vi.spyOn(ProfileRepository, 'fetchProfile').mockRejectedValue(new Error('no profile'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('どこにも所属していなければ初回ホームを出し、始め方の入口を置く', async () => {
    vi.mocked(KbRepository.fetchWorkspaces).mockResolvedValue([]);
    renderHome();

    expect(await screen.findByRole('heading', { level: 1, name: 'FreStyle へようこそ。' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ナレッジをひらく/ })).toHaveAttribute('href', '/kb');
    expect(screen.getByRole('link', { name: /バックログをひらく/ })).toHaveAttribute('href', '/backlog');
    expect(screen.getByRole('link', { name: /あなたへの招待を確認/ })).toHaveAttribute('href', '/invitations');
    expect(screen.queryByRole('heading', { name: 'マイホーム' })).not.toBeInTheDocument();
  });

  it('最後に開いたページをカードで出し、本文を取らない（閲覧の記録を書き換えない）', async () => {
    const fetchPage = vi.spyOn(KbRepository, 'fetchPage');
    vi.mocked(KbRepository.fetchRecentPages).mockResolvedValue([
      recentPage,
      { ...recentPage, pageId: 'page-2', title: '議事録' },
      { ...recentPage, pageId: 'page-3', title: '手順書' },
    ]);
    renderHome();

    const card = await screen.findByRole('article', { name: '設計メモ' });
    expect(within(card).getByText('開発チーム / 開発ノート')).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: /続きをひらく/ })).toHaveAttribute('href', '/kb/page-1');

    // 狭い画面は合計 2 件（カード + 1 行）。「履歴」で残りを広げる。
    const rows = screen.getByRole('list', { name: '最近開いたページ' });
    expect(within(rows).getAllByRole('listitem')).toHaveLength(1);
    const toggle = screen.getByRole('button', { name: /履歴/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(within(rows).getAllByRole('listitem')).toHaveLength(2);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('参照チケットは最新のページ 1 件分だけ取り、0 件なら節ごと出さない', async () => {
    vi.mocked(KbRepository.fetchRecentPages).mockResolvedValue([recentPage, { ...recentPage, pageId: 'page-2' }]);
    renderHome();

    await screen.findByRole('article', { name: '設計メモ' });
    expect(TicketRepository.fetchPageTicketReferences).toHaveBeenCalledTimes(1);
    expect(TicketRepository.fetchPageTicketReferences).toHaveBeenCalledWith('team-a', 'page-1', 2, expect.anything());
    expect(screen.queryByText('このページを参照しているチケット')).not.toBeInTheDocument();
  });

  it('画面を離れたら履歴の取得を中断する', () => {
    let signal: AbortSignal | undefined;
    vi.mocked(KbRepository.fetchRecentPages).mockImplementation((requestSignal) => {
      signal = requestSignal;
      return new Promise(() => {});
    });
    const { unmount } = renderHome();

    expect(signal?.aborted).toBe(false);
    unmount();
    expect(signal?.aborted).toBe(true);
  });

  it('履歴の取得失敗を 0 件と区別し、再試行で戻る', async () => {
    vi.mocked(KbRepository.fetchRecentPages)
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([recentPage]);
    renderHome();

    expect(await screen.findByText('最近のページを取得できませんでした。')).toHaveAttribute('role', 'alert');
    expect(screen.queryByText('表示できる履歴はありません')).not.toBeInTheDocument();
    const section = screen.getByRole('region', { name: '続きからはじめる' });
    fireEvent.click(within(section).getByRole('button', { name: '再試行' }));

    expect(await screen.findByRole('article', { name: '設計メモ' })).toBeInTheDocument();
    expect(KbRepository.fetchRecentPages).toHaveBeenCalledTimes(2);
  });

  it('自分の担当は横断の口から 3 件だけ取り、狭い画面では 2 件を並べる', async () => {
    vi.mocked(TicketRepository.fetchMyAssignedTickets).mockResolvedValue([
      assignedTicket,
      { ...assignedTicket, id: 't2', number: 25, title: '二つ目', dueDate: null },
      { ...assignedTicket, id: 't3', number: 26, title: '三つ目' },
    ]);
    renderHome();

    const list = await screen.findByRole('list', { name: '自分の担当' });
    expect(TicketRepository.fetchMyAssignedTickets).toHaveBeenCalledWith(3, expect.anything());
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('link', { name: /初めての人が迷わず参加できる導線にする/ })).toHaveAttribute(
      'href',
      '/tickets/t1',
    );
    expect(within(list).getByText('APP-24')).toBeInTheDocument();
    expect(within(list).getByText('開発チーム / FreStyle')).toBeInTheDocument();
    expect(within(list).getByText('期限なし')).toBeInTheDocument();
    expect(screen.getByText('2件を表示')).toBeInTheDocument();
  });
});
