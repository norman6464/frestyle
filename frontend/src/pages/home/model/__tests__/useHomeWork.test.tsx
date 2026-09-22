import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import KbRepository from '@/entities/kb/api/kbRepository';
import { TicketRepository, type AssignedTicket } from '@/entities/ticket';
import { useHomeWork } from '../useHomeWork';

const workspace = (slug: string) => ({ slug, name: slug, createdAt: '', canManage: false });
const ticket: AssignedTicket = {
  id: 't1', projectId: 'p1', projectKey: 'APP', projectName: '開発', number: 1, title: '担当の作業',
  typeName: 'タスク', statusName: '未着手', statusCategory: 'todo', statusColor: '#2563eb', priority: 2, dueDate: null,
};

describe('useHomeWork', () => {
  beforeEach(() => {
    vi.spyOn(KbRepository, 'fetchWorkspaces').mockResolvedValue([workspace('a'), workspace('b')]);
    vi.spyOn(TicketRepository, 'fetchAssignedTickets').mockResolvedValue([]);
  });
  afterEach(() => vi.restoreAllMocks());

  it('参加先それぞれから自分の担当を取得し、統合する', async () => {
    vi.mocked(TicketRepository.fetchAssignedTickets).mockResolvedValueOnce([ticket]);
    const { result } = renderHook(useHomeWork);
    expect(result.current.status).toBe('loading');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(TicketRepository.fetchAssignedTickets).toHaveBeenCalledWith('a');
    expect(TicketRepository.fetchAssignedTickets).toHaveBeenCalledWith('b');
    expect(result.current.tickets).toEqual([ticket]);
  });

  it('一部の取得失敗を明示し、成功した担当を残す', async () => {
    vi.mocked(TicketRepository.fetchAssignedTickets)
      .mockRejectedValueOnce(new Error('unavailable')).mockResolvedValueOnce([ticket]);
    const { result } = renderHook(useHomeWork);
    await waitFor(() => expect(result.current.status).toBe('partial'));
    expect(result.current.tickets).toEqual([ticket]);
  });

  it('全ての担当取得の失敗は空状態と区別し、再試行できる', async () => {
    vi.mocked(TicketRepository.fetchAssignedTickets).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(useHomeWork);
    await waitFor(() => expect(result.current.status).toBe('error'));
    vi.mocked(TicketRepository.fetchAssignedTickets).mockResolvedValueOnce([ticket]).mockResolvedValue([]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.tickets).toEqual([ticket]);
  });

  it('参加先一覧の失敗もエラーにする', async () => {
    vi.mocked(KbRepository.fetchWorkspaces).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(useHomeWork);
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(TicketRepository.fetchAssignedTickets).not.toHaveBeenCalled();
  });

  it('参加先がない場合は正常な空状態にする', async () => {
    vi.mocked(KbRepository.fetchWorkspaces).mockResolvedValue([]);
    const { result } = renderHook(useHomeWork);
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.tickets).toEqual([]);
  });

  it('再試行後に返った古いリクエストで新しい結果を上書きしない', async () => {
    let resolveOld!: (tickets: AssignedTicket[]) => void;
    vi.mocked(KbRepository.fetchWorkspaces).mockResolvedValue([workspace('a')]);
    vi.mocked(TicketRepository.fetchAssignedTickets)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }))
      .mockResolvedValue([ticket]);
    const { result } = renderHook(useHomeWork);
    await waitFor(() => expect(TicketRepository.fetchAssignedTickets).toHaveBeenCalledTimes(1));
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.tickets).toEqual([ticket]));
    await act(async () => resolveOld([{ ...ticket, id: 'old' }]));
    expect(result.current.tickets).toEqual([ticket]);
    expect(result.current.status).toBe('ready');
  });
});
