import { renderHook as rtlRenderHook, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { kbKeys } from '@/entities/kb/api/kbQueries';
import { createTestQueryClient, queryWrapper } from '@/test/queryClient';
import { useKbSuggestionDraft } from '../useKbSuggestionDraft';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

function tooManyOpenSuggestionsError(): AxiosError {
  return new AxiosError('Too Many Requests', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 429,
    statusText: 'Too Many Requests',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'too_many_open_suggestions' },
  });
}

const hoisted = vi.hoisted(() => ({ createSuggestion: vi.fn() }));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: { createSuggestion: hoisted.createSuggestion },
}));

const doc = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }] };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useKbSuggestionDraft', () => {
  it('初期状態は閉じている', () => {
    const { result } = renderHook(() => useKbSuggestionDraft('w-1', 'p-1'));
    expect(result.current.open).toBe(false);
    expect(result.current.draft).toBeNull();
  });

  it('start でドラフトモードに入り、渡した doc が下書きの初期値になる', () => {
    const { result } = renderHook(() => useKbSuggestionDraft('w-1', 'p-1'));
    act(() => result.current.start(doc));
    expect(result.current.open).toBe(true);
    expect(result.current.draft).toEqual(doc);
  });

  it('changeDraft は打鍵ごとに描き直さず（APIへも送らない）、送信のときに書き換え後の下書きを送る', async () => {
    hoisted.createSuggestion.mockResolvedValue({ id: 's-1', doc, status: 'open', author: { userId: 1, name: '' }, createdAt: '2026-09-01T00:00:00Z' });
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useKbSuggestionDraft('w-1', 'p-1');
    });
    act(() => result.current.start(doc));
    const changed = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '書き換え後' }] }] };
    const before = renders;

    act(() => result.current.changeDraft(changed));
    act(() => result.current.changeDraft(changed));

    expect(renders).toBe(before);
    expect(hoisted.createSuggestion).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.submit();
    });
    expect(hoisted.createSuggestion).toHaveBeenCalledWith('w-1', 'p-1', changed);
  });

  it('cancel でドラフトを破棄して閉じる', () => {
    const { result } = renderHook(() => useKbSuggestionDraft('w-1', 'p-1'));
    act(() => result.current.start(doc));
    act(() => result.current.cancel());
    expect(result.current.open).toBe(false);
    expect(result.current.draft).toBeNull();
    expect(hoisted.createSuggestion).not.toHaveBeenCalled();
  });

  it('submit は1回だけ createSuggestion を呼び、成功したら閉じて true を返す', async () => {
    hoisted.createSuggestion.mockResolvedValue({ id: 's-1', doc, status: 'open', author: { userId: 1, name: '' }, createdAt: '2026-09-01T00:00:00Z' });
    const { result } = renderHook(() => useKbSuggestionDraft('w-1', 'p-1'));
    act(() => result.current.start(doc));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.submit();
    });

    expect(ok).toBe(true);
    expect(hoisted.createSuggestion).toHaveBeenCalledTimes(1);
    expect(hoisted.createSuggestion).toHaveBeenCalledWith('w-1', 'p-1', doc);
    expect(result.current.open).toBe(false);
  });

  it('送ったら、そのページの提案の一覧を古いものにする（提案のパネルに出る）', async () => {
    hoisted.createSuggestion.mockResolvedValue({ id: 's-1', doc, status: 'open', author: { userId: 1, name: '' }, createdAt: '2026-09-01T00:00:00Z' });
    const client = createTestQueryClient();
    client.setQueryData(kbKeys.suggestions('w-1', 'p-1'), []);
    client.setQueryData(kbKeys.suggestions('w-1', 'p-2'), []);
    const { result } = renderHook(() => useKbSuggestionDraft('w-1', 'p-1'), { wrapper: queryWrapper(client) });
    act(() => result.current.start(doc));

    await act(async () => {
      await result.current.submit();
    });

    expect(client.getQueryState(kbKeys.suggestions('w-1', 'p-1'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(kbKeys.suggestions('w-1', 'p-2'))?.isInvalidated).toBe(false);
  });

  it('submit が失敗したらドラフトモードのまま、入力を保持し、エラーを持つ', async () => {
    hoisted.createSuggestion.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useKbSuggestionDraft('w-1', 'p-1'));
    act(() => result.current.start(doc));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.submit();
    });

    expect(ok).toBe(false);
    expect(result.current.open).toBe(true);
    expect(result.current.draft).toEqual(doc);
    expect(result.current.error).toBe('提案を送信できませんでした。');
  });

  it('未解決の提案数の上限（429）は専用のメッセージを出す', async () => {
    hoisted.createSuggestion.mockRejectedValue(tooManyOpenSuggestionsError());
    const { result } = renderHook(() => useKbSuggestionDraft('w-1', 'p-1'));
    act(() => result.current.start(doc));

    await act(async () => {
      await result.current.submit();
    });

    expect(result.current.error).toBe('未解決の提案が多すぎます。既存の提案が解決されるのを待ってから送信してください。');
  });

  it('送信中にページを移ったら、後から届く失敗が移った先の下書きstateを汚さない', async () => {
    let rejectCreate: (err: unknown) => void = () => {};
    hoisted.createSuggestion.mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string }) => useKbSuggestionDraft('w-1', pageId),
      { initialProps: { pageId: 'p-1' } },
    );
    act(() => result.current.start(doc));

    let submitPromise: Promise<boolean> | undefined;
    act(() => {
      submitPromise = result.current.submit();
    });

    // 送信がまだ飛んでいる間にページを移り、移った先で新しいドラフトを開く。
    rerender({ pageId: 'p-2' });
    await waitFor(() => expect(result.current.open).toBe(false));
    act(() => result.current.start(doc));
    expect(result.current.open).toBe(true);

    // ここでようやく古い送信（p-1 宛て）が失敗として着地する。
    act(() => rejectCreate(new Error('boom')));
    await act(async () => {
      await submitPromise;
    });

    // 移った先（p-2）で開いている新しいドラフトは、古い送信の失敗で閉じたりエラーが
    // 出たりしてはいけない。
    expect(result.current.open).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('ページを移ったら書きかけの下書きを持ち越さない', async () => {
    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string }) => useKbSuggestionDraft('w-1', pageId),
      { initialProps: { pageId: 'p-1' } },
    );
    act(() => result.current.start(doc));
    expect(result.current.open).toBe(true);

    rerender({ pageId: 'p-2' });
    await waitFor(() => expect(result.current.open).toBe(false));
    expect(result.current.draft).toBeNull();
  });
});
