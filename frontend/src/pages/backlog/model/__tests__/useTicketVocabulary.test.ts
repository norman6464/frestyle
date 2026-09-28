import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketKeys, type Ticket } from '@/entities/ticket';
import { sprintKeys } from '@/entities/sprint';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useTicketVocabulary } from '../useTicketVocabulary';

const hoisted = vi.hoisted(() => ({
  fetchVersions: vi.fn(),
  fetchTicketFixVersions: vi.fn(),
  setTicketFixVersion: vi.fn(),
  fetchTeams: vi.fn(),
  setTicketTeam: vi.fn(),
  fetchTicketSprint: vi.fn(),
}));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/project-version/api/projectVersionRepository', () => ({
  ProjectVersionRepository: {
    fetchVersions: hoisted.fetchVersions,
    fetchTicketFixVersions: hoisted.fetchTicketFixVersions,
    setTicketFixVersion: hoisted.setTicketFixVersion,
  },
}));
vi.mock('@/entities/team/api/teamRepository', () => ({
  TeamRepository: { fetchTeams: hoisted.fetchTeams, setTicketTeam: hoisted.setTicketTeam },
}));
vi.mock('@/entities/sprint/api/sprintRepository', () => ({
  SprintRepository: { fetchTicketSprint: hoisted.fetchTicketSprint },
}));

// 共有の問い合わせを使うので、テストごとに新しい置き場の中で描く。
const renderHook = ((callback, options) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const version = (id: string) => ({ id, projectId: 'p-1', name: id, releasedAt: null, archivedAt: null, createdAt: '', updatedAt: '' });
const sprint = (id: string, name: string) => ({ id, projectId: 'p-1', name, state: 'active' });

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchVersions.mockResolvedValue([version('v-1'), version('v-2')]);
  hoisted.fetchTeams.mockResolvedValue([{ id: 'team-1', projectId: 'p-1', name: '基盤' }]);
  hoisted.fetchTicketFixVersions.mockResolvedValue([version('v-1')]);
  hoisted.fetchTicketSprint.mockResolvedValue(null);
});

describe('useTicketVocabulary', () => {
  it('プロジェクトの版とチーム、チケットに付いている版と入っているスプリントを読む', async () => {
    hoisted.fetchTicketSprint.mockResolvedValue(sprint('sp-1', 'Sprint 3'));
    const { result } = renderHook(() => useTicketVocabulary('acme', 'p-1', 't-1'));
    await waitFor(() => expect(result.current.sprint?.name).toBe('Sprint 3'));
    await waitFor(() => expect(result.current.versions).toHaveLength(2));
    expect(result.current.teams).toHaveLength(1);
    expect(result.current.fixVersions.map((v) => v.id)).toEqual(['v-1']);
  });

  it('取れなくても空で返す（ほかの項目は読める）', async () => {
    hoisted.fetchVersions.mockRejectedValue(new Error('network'));
    hoisted.fetchTicketSprint.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useTicketVocabulary('acme', 'p-1', 't-1'));
    await waitFor(() => expect(result.current.teams).toHaveLength(1));
    expect(result.current.versions).toEqual([]);
    expect(result.current.sprint).toBeNull();
  });

  it('チケットを切り替えても、プロジェクトの版とチームは取り直さない', async () => {
    const { result, rerender } = renderHook(({ ticketId }) => useTicketVocabulary('acme', 'p-1', ticketId), {
      initialProps: { ticketId: 't-1' },
    });
    await waitFor(() => expect(result.current.versions).toHaveLength(2));

    rerender({ ticketId: 't-2' });
    await waitFor(() => expect(hoisted.fetchTicketFixVersions).toHaveBeenCalledWith('acme', 't-2'));
    expect(hoisted.fetchVersions).toHaveBeenCalledTimes(1);
    expect(hoisted.fetchTeams).toHaveBeenCalledTimes(1);
  });

  it('スプリントへ入れて古くなったら、詳細の欄のスプリントを取り直す（「バックログ」のまま残らない）', async () => {
    const client = createTestQueryClient();
    const { result } = renderHook(() => useTicketVocabulary('acme', 'p-1', 't-1'), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(hoisted.fetchTicketSprint).toHaveBeenCalled());
    expect(result.current.sprint).toBeNull();

    // スプリントへ入れる書き込み（useSprints）が古くする鍵。
    hoisted.fetchTicketSprint.mockResolvedValue(sprint('sp-1', 'Sprint 3'));
    void client.invalidateQueries({ queryKey: sprintKeys.allTicketSprints('acme') });

    await waitFor(() => expect(result.current.sprint?.name).toBe('Sprint 3'));
  });

  it('版の付け外しは、返ってきた一式を映す', async () => {
    hoisted.setTicketFixVersion.mockResolvedValue([version('v-1'), version('v-2')]);
    const { result } = renderHook(() => useTicketVocabulary('acme', 'p-1', 't-1'));
    await waitFor(() => expect(result.current.fixVersions).toHaveLength(1));

    await act(async () => {
      await result.current.setFixVersion('v-2', true);
    });

    expect(hoisted.setTicketFixVersion).toHaveBeenCalledWith('acme', 't-1', 'v-2', true);
    await waitFor(() => expect(result.current.fixVersions.map((v) => v.id)).toEqual(['v-1', 'v-2']));
  });

  it('担当チームを差し替えたら、チケットを載せている控え（一覧と 1 件の画面）へ映す', async () => {
    hoisted.setTicketTeam.mockResolvedValue({ id: 't-1', teamId: 'team-1' });
    const client = createTestQueryClient();
    const listKey = ticketKeys.list('acme', 'p-1', {});
    client.setQueryData(listKey, [{ id: 't-1', teamId: null } as unknown as Ticket]);
    client.setQueryData(ticketKeys.resolved('t-1'), { ticket: { id: 't-1', teamId: null } });
    const { result } = renderHook(() => useTicketVocabulary('acme', 'p-1', 't-1'), { wrapper: queryWrapper(client) });

    await act(async () => {
      await result.current.changeTeam('team-1');
    });

    expect(hoisted.setTicketTeam).toHaveBeenCalledWith('acme', 't-1', 'team-1');
    expect(client.getQueryData<Ticket[]>(listKey)?.[0].teamId).toBe('team-1');
    expect(client.getQueryData<{ ticket: Ticket }>(ticketKeys.resolved('t-1'))?.ticket.teamId).toBe('team-1');
  });

  it('チームを外した応答（teamId が無い）は null として映す', async () => {
    hoisted.setTicketTeam.mockResolvedValue({ id: 't-1' });
    const client = createTestQueryClient();
    const listKey = ticketKeys.list('acme', 'p-1', {});
    client.setQueryData(listKey, [{ id: 't-1', teamId: 'team-1' } as unknown as Ticket]);
    const { result } = renderHook(() => useTicketVocabulary('acme', 'p-1', 't-1'), { wrapper: queryWrapper(client) });

    await act(async () => {
      await result.current.changeTeam('');
    });

    expect(client.getQueryData<Ticket[]>(listKey)?.[0].teamId).toBeNull();
  });
});
