import { act, renderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryWrapper } from '@/test/queryClient';
import { useKbInvitations } from '../useKbInvitations';

const hoisted = vi.hoisted(() => ({ fetchInvitations: vi.fn(), inviteByEmail: vi.fn() }));

vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: { fetchInvitations: hoisted.fetchInvitations, inviteByEmail: hoisted.inviteByEmail },
}));

function status(code: number): AxiosError {
  return new AxiosError('x', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: code,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchInvitations.mockResolvedValue([]);
});

describe('useKbInvitations', () => {
  it.each([403, 404])('%d は admin でない（画面ごと出し分ける）', async (code) => {
    hoisted.fetchInvitations.mockRejectedValue(status(code));
    const { result } = renderHook(() => useKbInvitations('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.error).toBe('forbidden'));
  });

  it('発行したら一覧を取り直してから、1 回しか返らない token つきの応答を返す', async () => {
    const issued = { invitation: { id: 'i-1', email: 'a@example.com' }, token: 'tok' };
    hoisted.inviteByEmail.mockResolvedValue(issued);
    const { result } = renderHook(() => useKbInvitations('acme'), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.fetchInvitations.mockResolvedValue([issued.invitation]);

    let returned: unknown;
    await act(async () => {
      returned = await result.current.invite({ email: 'a@example.com', role: 'viewer' } as never);
    });

    expect(returned).toEqual(issued);
    expect(result.current.invitations).toEqual([issued.invitation]);
  });
});
