import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useMyInvitations } from '../useMyInvitations';

const hoisted = vi.hoisted(() => ({
  fetchMyInvitations: vi.fn(),
  acceptInvitation: vi.fn(),
}));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    fetchMyInvitations: hoisted.fetchMyInvitations,
    acceptInvitation: hoisted.acceptInvitation,
  },
}));

const INVITATION = { id: 'inv-1', workspaceName: 'Acme', role: 'member' };

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchMyInvitations.mockResolvedValue([INVITATION]);
});

describe('useMyInvitations', () => {
  it('承諾したら、所属の一覧とその中のものを古いものとして取り直させる', async () => {
    hoisted.acceptInvitation.mockResolvedValue({ workspaceSlug: 'acme' });
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.workspaces(), []);
    client.setQueryData(kbKeys.mySpaces('other'), []);
    const { result } = renderHook(() => useMyInvitations(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.accept('inv-1');
    });

    expect(client.getQueryState(kbKeys.workspaces())?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.mySpaces('other'))?.isInvalidated).toBe(true);
    expect(result.current.invitations).toEqual([]);
  });

  it('承諾に失敗したら、所属の一覧はそのまま', async () => {
    hoisted.acceptInvitation.mockRejectedValue(new Error('gone'));
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.workspaces(), []);
    const { result } = renderHook(() => useMyInvitations(), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await expect(result.current.accept('inv-1')).rejects.toThrow('gone');
    });

    expect(client.getQueryState(kbKeys.workspaces())?.isInvalidated).toBe(false);
  });
});
