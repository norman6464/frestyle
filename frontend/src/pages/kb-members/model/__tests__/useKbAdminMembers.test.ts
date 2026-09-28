import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceKeys } from '@/entities/workspace/api/workspaceQueries';
import type { AdminWorkspaceMember } from '@/entities/kb/model/types';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useKbAdminMembers } from '../useKbAdminMembers';

const hoisted = vi.hoisted(() => ({ fetchAdminMembers: vi.fn(), suspendMember: vi.fn() }));

vi.mock('@/entities/workspace/api/workspaceRepository', () => ({
  default: {
    fetchAdminMembers: hoisted.fetchAdminMembers,
    suspendMember: hoisted.suspendMember,
  },
}));

const member = (userId: number, suspended = false): AdminWorkspaceMember => ({
  userId,
  principalId: `p-${userId}`,
  name: `人${userId}`,
  accountStatus: suspended ? 'suspended' : 'active',
  avatarUrl: '',
  statusMessage: '',
});

function forbidden(): AxiosError {
  return new AxiosError('Forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 403,
    statusText: 'Forbidden',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchAdminMembers.mockResolvedValue([member(1), member(2)]);
  hoisted.suspendMember.mockResolvedValue(undefined);
});

describe('useKbAdminMembers', () => {
  it('admin でなければ（403）画面ごと出し分けるための forbidden を返す', async () => {
    hoisted.fetchAdminMembers.mockRejectedValue(forbidden());
    const { result } = renderHook(() => useKbAdminMembers('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.error).toBe('forbidden'));
  });

  it('書き込みが成功したら一覧を丸ごと取り直し、取り直しを待ってから返す。名指しの候補も古くする', async () => {
    const client = createTestQueryClient();
    client.setQueryData(workspaceKeys.members('acme'), []);
    const { result } = renderHook(() => useKbAdminMembers('acme'), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.members).toHaveLength(2));
    hoisted.fetchAdminMembers.mockResolvedValue([member(1), member(2, true)]);

    let suspending: Promise<void> = Promise.resolve();
    act(() => {
      suspending = result.current.suspend(2);
    });
    await waitFor(() => expect(result.current.busyUserId).toBe(2));
    await act(async () => {
      await suspending;
    });

    expect(hoisted.fetchAdminMembers).toHaveBeenCalledTimes(2);
    const members = client.getQueryData<AdminWorkspaceMember[]>(workspaceKeys.adminMembers('acme'));
    expect(members?.find(({ userId }) => userId === 2)?.accountStatus).toBe('suspended');
    expect(result.current.members.find(({ userId }) => userId === 2)?.accountStatus).toBe('suspended');
    expect(client.getQueryState(workspaceKeys.members('acme'))?.isInvalidated).toBe(true);
    await waitFor(() => expect(result.current.busyUserId).toBeNull());
  });

  it('取り直しが 403 になったら（admin でなくなった）、持っている一覧も出さずに forbidden にする', async () => {
    const { result } = renderHook(() => useKbAdminMembers('acme'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.members).toHaveLength(2));

    hoisted.fetchAdminMembers.mockRejectedValue(forbidden());
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.error).toBe('forbidden'));
    expect(result.current.members).toEqual([]);
  });

  it('書き込みに失敗したら投げ、一覧は取り直さない', async () => {
    hoisted.suspendMember.mockRejectedValue(new Error('last_admin'));
    const { result } = renderHook(() => useKbAdminMembers('acme'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.members).toHaveLength(2));

    await act(async () => {
      await expect(result.current.suspend(1)).rejects.toThrow('last_admin');
    });

    expect(hoisted.fetchAdminMembers).toHaveBeenCalledTimes(1);
    expect(result.current.busyUserId).toBeNull();
  });
});
