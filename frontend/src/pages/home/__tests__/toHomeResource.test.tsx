import { act, renderHook, waitFor } from '@testing-library/react';
import { useQuery } from '@tanstack/react-query';
import { describe, it, expect, vi } from 'vitest';
import { queryWrapper } from '@/test/queryClient';
import { toHomeResource } from '../model/useHomeResource';

function useResource(load: () => Promise<string[]>, enabled = true) {
  return toHomeResource(useQuery({ queryKey: ['home-test'], queryFn: load, enabled }), [] as string[]);
}

describe('toHomeResource', () => {
  it('読み込み中は初期値で loading、届いたら ready', async () => {
    const { result } = renderHook(() => useResource(async () => ['a']), { wrapper: queryWrapper() });
    expect(result.current).toMatchObject({ data: [], status: 'loading' });

    await waitFor(() => expect(result.current).toMatchObject({ data: ['a'], status: 'ready' }));
  });

  it('前提が揃わず読まない間は loading', () => {
    const load = vi.fn(async () => ['a']);
    const { result } = renderHook(() => useResource(load, false), { wrapper: queryWrapper() });

    expect(result.current.status).toBe('loading');
    expect(load).not.toHaveBeenCalled();
  });

  it('取り直しに失敗したら、前の結果を出さずに error', async () => {
    const load = vi.fn().mockResolvedValueOnce(['a']).mockRejectedValueOnce(new Error('gone'));
    const { result } = renderHook(() => useResource(load), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.status).toBe('ready'));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current).toMatchObject({ data: [], status: 'error' }));
  });

  it('失敗のあと再試行を押したら、取り直している間は loading に戻す', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockImplementationOnce(() => new Promise(() => {}));
    const { result } = renderHook(() => useResource(load), { wrapper: queryWrapper() });
    await waitFor(() => expect(result.current.status).toBe('error'));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.status).toBe('loading'));
  });
});
