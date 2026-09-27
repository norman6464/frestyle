import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import HomePage from '../ui/HomePage';
import KbRepository from '@/entities/kb/api/kbRepository';
import TicketRepository from '@/entities/ticket/api/ticketRepository';
import { NotificationRepository } from '@/entities/notification/api/notificationRepository';
import ProfileRepository from '@/entities/user/api/profileRepository';
import { createMockStorage } from '@/test/mockStorage';

// 各欄は本物を描き、描かれた回数だけ数える。
const hoisted = vi.hoisted(() => ({ renders: { resume: 0, assigned: 0, favorites: 0 } }));
vi.mock('../ui/HomeResumeSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/HomeResumeSection')>();
  const Real = actual.default;
  return {
    ...actual,
    default: (props: Parameters<typeof Real>[0]) => {
      hoisted.renders.resume += 1;
      return <Real {...props} />;
    },
  };
});
vi.mock('../ui/HomeAssignedSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/HomeAssignedSection')>();
  const Real = actual.default;
  return {
    ...actual,
    default: (props: Parameters<typeof Real>[0]) => {
      hoisted.renders.assigned += 1;
      return <Real {...props} />;
    },
  };
});
vi.mock('../ui/HomeFavoritesSection', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../ui/HomeFavoritesSection')>();
  const Real = actual.default;
  return {
    ...actual,
    default: (props: Parameters<typeof Real>[0]) => {
      hoisted.renders.favorites += 1;
      return <Real {...props} />;
    },
  };
});

const workspace = { slug: 'team-a', name: '開発チーム', createdAt: '', canManage: false, canCreateTickets: true };

describe('HomePage の描き直しの範囲', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createMockStorage());
    vi.spyOn(KbRepository, 'fetchWorkspaces').mockResolvedValue([workspace]);
    vi.spyOn(KbRepository, 'fetchRecentPages').mockResolvedValue([]);
    vi.spyOn(KbRepository, 'fetchFavorites').mockResolvedValue([]);
    vi.spyOn(KbRepository, 'fetchSpaces').mockResolvedValue([]);
    vi.spyOn(TicketRepository, 'fetchMyAssignedTickets').mockResolvedValue([]);
    vi.spyOn(TicketRepository, 'fetchPageTicketReferences').mockResolvedValue([]);
    vi.spyOn(NotificationRepository, 'getUnreadCount').mockResolvedValue(0);
    vi.spyOn(ProfileRepository, 'fetchProfile').mockRejectedValue(new Error('no profile'));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('「新しくつくる」を開いて閉じても、ホームの各欄を描き直さない', async () => {
    render(
      <MemoryRouter>
        <HomePage />
      </MemoryRouter>,
    );
    await screen.findByText('表示できる履歴はありません');
    await screen.findByText('未完了の担当はありません');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 30));
    });
    hoisted.renders = { resume: 0, assigned: 0, favorites: 0 };

    fireEvent.click(screen.getByRole('button', { name: '新しくつくる' }));
    await screen.findByRole('dialog');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    expect(hoisted.renders).toEqual({ resume: 0, assigned: 0, favorites: 0 });
  });
});
