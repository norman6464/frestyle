import { renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { workspaceKeys } from '@/entities/workspace/api/workspaceQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { usePrincipalNames } from '../usePrincipalNames';

const hoisted = vi.hoisted(() => ({ fetchMembers: vi.fn() }));

// 取得の本体を偽物にする（公開口だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/workspace/api/workspaceRepository', () => ({
  default: { fetchMembers: hoisted.fetchMembers },
}));

const MEMBERS = [
  { principalId: 'pr-1', userId: 1, name: '田中 太郎' },
  { principalId: 'pr-2', userId: 2, name: '' },
];

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.fetchMembers.mockResolvedValue(MEMBERS);
});

describe('usePrincipalNames', () => {
  it('ワークスペースに属する人の一覧から、担当（principalId）の名前を引く', async () => {
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.nameOf('pr-1')).toBe('田中 太郎'));
    expect(hoisted.fetchMembers).toHaveBeenCalledWith('acme');
    expect(result.current.members).toEqual(MEMBERS);
  });

  it('権限を張れる相手の口（ページの管理権限が要る）はたどらない', async () => {
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.members).toEqual(MEMBERS));
  });

  it('担当が無い・一覧に無い・名前が引けない人は空文字', async () => {
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(result.current.members).toEqual(MEMBERS));
    expect(result.current.nameOf(null)).toBe('');
    expect(result.current.nameOf('pr-9')).toBe('');
    expect(result.current.nameOf('pr-2')).toBe('');
  });

  it('発言欄・属性の欄と同じ問い合わせを使い、取り直さない', async () => {
    const client = createTestQueryClient();
    client.setQueryData(workspaceKeys.members('acme'), MEMBERS);
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper(client) });

    await waitFor(() => expect(result.current.nameOf('pr-1')).toBe('田中 太郎'));
    expect(hoisted.fetchMembers).not.toHaveBeenCalled();
  });

  it('引けなくても落ちず、空のまま', async () => {
    hoisted.fetchMembers.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => usePrincipalNames('acme'), { wrapper: queryWrapper() });

    await waitFor(() => expect(hoisted.fetchMembers).toHaveBeenCalled());
    expect(result.current.members).toEqual([]);
    expect(result.current.nameOf('pr-1')).toBe('');
  });

  it('ワークスペースが決まるまでは取りに行かない', () => {
    const { result } = renderHook(() => usePrincipalNames(undefined), { wrapper: queryWrapper() });

    expect(result.current.members).toEqual([]);
    expect(hoisted.fetchMembers).not.toHaveBeenCalled();
  });
});
