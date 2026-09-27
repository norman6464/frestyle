import { renderHook as rtlRenderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useKbPageSuggestions } from '../useKbPageSuggestions';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const hoisted = vi.hoisted(() => ({
  listOpenSuggestions: vi.fn(),
  acceptSuggestion: vi.fn(),
  rejectSuggestion: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    listOpenSuggestions: hoisted.listOpenSuggestions,
    acceptSuggestion: hoisted.acceptSuggestion,
    rejectSuggestion: hoisted.rejectSuggestion,
  },
}));

const suggestion = (id: string) => ({
  id,
  doc: { type: 'doc', content: [] },
  status: 'open' as const,
  author: { userId: 1, name: '田中 太郎' },
  createdAt: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useKbPageSuggestions', () => {
  it('open=false の間は取得しない', () => {
    renderHook(() => useKbPageSuggestions('w-1', 'p-1', false));
    expect(hoisted.listOpenSuggestions).not.toHaveBeenCalled();
  });

  it('open になると一覧を取得する', async () => {
    hoisted.listOpenSuggestions.mockResolvedValue([suggestion('s-1')]);
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true));

    await waitFor(() => expect(hoisted.listOpenSuggestions).toHaveBeenCalledWith('w-1', 'p-1'));
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it('取得に失敗したらエラーを持つ', async () => {
    hoisted.listOpenSuggestions.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.suggestions).toEqual([]);
  });

  it('accept が成功すると一覧からその提案が消え、応答（反映後のdoc込み）を返す', async () => {
    hoisted.listOpenSuggestions.mockResolvedValue([suggestion('s-1'), suggestion('s-2')]);
    const accepted = { ...suggestion('s-1'), status: 'accepted' as const, doc: { type: 'doc', content: [{ type: 'paragraph' }] } };
    hoisted.acceptSuggestion.mockResolvedValue(accepted);
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true));
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));

    let returned: unknown;
    await act(async () => {
      returned = await result.current.accept('s-1');
    });

    expect(hoisted.acceptSuggestion).toHaveBeenCalledWith('w-1', 'p-1', 's-1');
    expect(returned).toEqual(accepted);
    await waitFor(() => expect(result.current.suggestions.map((s) => s.id)).toEqual(['s-2']));
  });

  it('採用したら版の一覧を古いものにする（採用は版を 1 つ切る）。却下では古くしない', async () => {
    hoisted.listOpenSuggestions.mockResolvedValue([suggestion('s-1'), suggestion('s-2')]);
    hoisted.acceptSuggestion.mockResolvedValue({ ...suggestion('s-1'), status: 'accepted' as const });
    hoisted.rejectSuggestion.mockResolvedValue({ ...suggestion('s-2'), status: 'rejected' as const });
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.versions('w-1', 'p-1'), []);
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true), { wrapper: queryWrapper(client) });
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));

    await act(async () => {
      await result.current.reject('s-2');
    });
    expect(client.getQueryState(kbKeys.versions('w-1', 'p-1'))?.isInvalidated).toBe(false);

    await act(async () => {
      await result.current.accept('s-1');
    });
    expect(client.getQueryState(kbKeys.versions('w-1', 'p-1'))?.isInvalidated).toBe(true);
  });

  it('reject が成功すると一覧からその提案が消える', async () => {
    hoisted.listOpenSuggestions.mockResolvedValue([suggestion('s-1')]);
    hoisted.rejectSuggestion.mockResolvedValue({ ...suggestion('s-1'), status: 'rejected' as const });
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true));
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));

    await act(async () => {
      await result.current.reject('s-1');
    });

    expect(hoisted.rejectSuggestion).toHaveBeenCalledWith('w-1', 'p-1', 's-1');
    await waitFor(() => expect(result.current.suggestions).toEqual([]));
  });

  it('accept が失敗したら投げる。一覧は変わらない', async () => {
    hoisted.listOpenSuggestions.mockResolvedValue([suggestion('s-1')]);
    hoisted.acceptSuggestion.mockRejectedValue(new Error('forbidden'));
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true));
    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));

    await expect(result.current.accept('s-1')).rejects.toThrow('forbidden');
    expect(result.current.suggestions).toHaveLength(1);
  });

  it('読み込めなかったら取り直せる', async () => {
    hoisted.listOpenSuggestions.mockRejectedValueOnce(new Error('boom')).mockResolvedValue([suggestion('s-1')]);
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.suggestions).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  it('取り直しの途中で採用しても、あとから届いた古い一覧で採用した提案が生き返らない', async () => {
    hoisted.listOpenSuggestions.mockResolvedValueOnce([suggestion('s-1'), suggestion('s-2')]);
    hoisted.acceptSuggestion.mockResolvedValue({ ...suggestion('s-1'), status: 'accepted' as const });
    const { result } = renderHook(() => useKbPageSuggestions('w-1', 'p-1', true));
    await waitFor(() => expect(result.current.suggestions).toHaveLength(2));
    let resolveStale: (value: ReturnType<typeof suggestion>[]) => void = () => {};
    hoisted.listOpenSuggestions.mockImplementationOnce(
      () => new Promise((resolve) => (resolveStale = resolve)),
    );
    act(() => result.current.retry());
    await waitFor(() => expect(hoisted.listOpenSuggestions).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.accept('s-1');
    });
    await act(async () => {
      resolveStale([suggestion('s-1'), suggestion('s-2')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.suggestions.map((s) => s.id)).toEqual(['s-2']);
  });
});
