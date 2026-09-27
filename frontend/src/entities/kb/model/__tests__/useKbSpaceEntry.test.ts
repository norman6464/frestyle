import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useKbSpaceEntry } from '../useKbSpaceEntry';

const hoisted = vi.hoisted(() => ({
  resolveKbSpace: vi.fn(),
  resolveEntryKbSpaceId: vi.fn(),
}));

vi.mock('../resolveKbSpace', () => ({
  resolveKbSpace: hoisted.resolveKbSpace,
  resolveEntryKbSpaceId: hoisted.resolveEntryKbSpaceId,
}));

const space = { id: 'space-1', name: '開発部', role: 'editor' as const };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useKbSpaceEntry', () => {
  it('見つからないことと、読み込めなかったことを分けて返す', async () => {
    hoisted.resolveKbSpace.mockResolvedValue(null);
    const { result } = renderHook(() => useKbSpaceEntry('space-9', () => {}));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.notFound).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('読み込めなかったら、取り直して続きを出せる', async () => {
    hoisted.resolveKbSpace.mockRejectedValueOnce(new Error('network'));
    const { result } = renderHook(() => useKbSpaceEntry('space-1', () => {}));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.notFound).toBe(false);

    hoisted.resolveKbSpace.mockResolvedValueOnce({ workspaceSlug: 'acme', space });
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.space?.id).toBe('space-1'));
    expect(result.current.error).toBeNull();
  });

  it('入口（spaceId 無し）で読み込めなかったときも取り直せる', async () => {
    hoisted.resolveEntryKbSpaceId.mockRejectedValueOnce(new Error('network'));
    const onResolved = vi.fn();
    const { result } = renderHook(() => useKbSpaceEntry(undefined, onResolved));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    hoisted.resolveEntryKbSpaceId.mockResolvedValueOnce('space-1');
    act(() => result.current.retry());

    await waitFor(() => expect(onResolved).toHaveBeenCalledWith('space-1'));
  });
});
