import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useAssignedTickets } from '../useAssignedTickets';
import type { AssignedTicket } from '@/entities/ticket';

const hoisted = vi.hoisted(() => ({
  fetchWorkspaces: vi.fn(),
  fetchAssignedTickets: vi.fn(),
}));

vi.mock('@/entities/kb', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/kb')>();
  return { ...actual, KbRepository: { fetchWorkspaces: hoisted.fetchWorkspaces } };
});

vi.mock('@/entities/ticket', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/entities/ticket')>();
  return { ...actual, TicketRepository: { fetchAssignedTickets: hoisted.fetchAssignedTickets } };
});

function ticket(id: string, statusName: string): AssignedTicket {
  return {
    id,
    workspaceId: 'w-1',
    projectId: 'p-1',
    number: 1,
    typeId: 'ty-1',
    statusId: 'st-1',
    parentId: null,
    title: id,
    doc: { type: 'doc', content: [] },
    priority: 0,
    storyPoints: null,
    teamId: null,
    startDate: null,
    dueDate: null,
    position: 'a0',
    closedAt: null,
    resolution: null,
    createdByUserId: 1,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    assigneePrincipalId: null,
    labels: [],
    projectKey: 'PJ',
    projectName: 'プロジェクト',
    statusName,
    statusCategory: 'in_progress',
    statusColor: '#a0661a',
    typeName: '開発タスク',
  } as AssignedTicket;
}

describe('useAssignedTickets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('状態ごとに束ね、見出しは最初に出てきた順になる', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([{ slug: 'acme' }]);
    hoisted.fetchAssignedTickets.mockResolvedValue([
      ticket('t-1', '進行中'),
      ticket('t-2', '進行中'),
      ticket('t-3', 'レビュー中'),
    ]);

    const { result } = renderHook(() => useAssignedTickets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.map((g) => g.name)).toEqual(['進行中', 'レビュー中']);
    expect(result.current.groups[0].tickets).toHaveLength(2);
    expect(result.current.total).toBe(3);
  });

  // backend が並べているのはワークスペース 1 つ分まで。繋げると同じ状態名が離れて現れるので、
  // 「隣り合っていたら同じ束」では見出しが重複する（「進行中」が 2 回出る）。
  it('ワークスペースを跨いでも同じ状態の見出しは 1 つに束ねる', async () => {
    hoisted.fetchWorkspaces.mockResolvedValue([{ slug: 'acme' }, { slug: 'beta' }]);
    hoisted.fetchAssignedTickets
      .mockResolvedValueOnce([ticket('t-1', '進行中'), ticket('t-2', '完了')])
      .mockResolvedValueOnce([ticket('t-3', '進行中'), ticket('t-4', '完了')]);

    const { result } = renderHook(() => useAssignedTickets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.map((g) => g.name)).toEqual(['進行中', '完了']);
    expect(result.current.groups[0].tickets.map((t) => t.id)).toEqual(['t-1', 't-3']);
    expect(result.current.total).toBe(4);
  });

  it('取れなければ知らせる（空の一覧として黙って出さない）', async () => {
    hoisted.fetchWorkspaces.mockRejectedValue(new Error('boom'));

    const { result } = renderHook(() => useAssignedTickets());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('担当の一覧を取得できませんでした。');
    expect(result.current.groups).toEqual([]);
  });
});
