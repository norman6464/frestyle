import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryWrapper } from '@/test/queryClient';
import { useKbPageVersions } from '../useKbPageVersions';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const hoisted = vi.hoisted(() => ({
  listPageVersions: vi.fn(),
  getPageVersion: vi.fn(),
  createPageVersion: vi.fn(),
  restorePageVersion: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    listPageVersions: hoisted.listPageVersions,
    getPageVersion: hoisted.getPageVersion,
    createPageVersion: hoisted.createPageVersion,
    restorePageVersion: hoisted.restorePageVersion,
  },
}));

const SLUG = 'w-3f2a9c';
const PAGE = 'p1';

const author = (name = '田中 太郎', userId = 1) => ({ userId, name });

const version = (seq: number, note: string | null = null) => ({
  seq,
  author: author(),
  note,
  createdAt: '2026-09-01T00:00:00Z',
});

const detail = (seq: number) => ({
  ...version(seq),
  doc: { type: 'doc', content: [{ type: 'paragraph' }] },
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listPageVersions.mockResolvedValue([version(2), version(1)]);
  hoisted.getPageVersion.mockResolvedValue(detail(1));
  hoisted.createPageVersion.mockResolvedValue(detail(3));
  hoisted.restorePageVersion.mockResolvedValue({
    doc: { type: 'doc', content: [{ type: 'paragraph' }] },
    builtAt: '2026-09-06T00:00:00Z',
    lastEditedBy: author(),
    lastEditedAt: '2026-09-06T00:00:00Z',
  });
});

describe('useKbPageVersions の一覧取得（open ゲート）', () => {
  it('open=false の間は取りに行かない', () => {
    renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    expect(hoisted.listPageVersions).not.toHaveBeenCalled();
  });

  it('workspaceSlug/pageId のどちらかが欠けていれば open=true でも取りに行かない', () => {
    renderHook(() => useKbPageVersions(undefined, PAGE, true));
    renderHook(() => useKbPageVersions(SLUG, undefined, true));

    expect(hoisted.listPageVersions).not.toHaveBeenCalled();
  });

  it('open=true になると取得する（新しい順のまま）', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.listPageVersions).toHaveBeenCalledWith(SLUG, PAGE);
    expect(result.current.versions.map((v) => v.seq)).toEqual([2, 1]);
  });

  it('閉じると state を畳む（次に開いたとき前のページの版を出さない）', async () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useKbPageVersions(SLUG, PAGE, open),
      { initialProps: { open: true } },
    );
    await waitFor(() => expect(result.current.versions).toHaveLength(2));

    rerender({ open: false });

    expect(result.current.versions).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('読み込みに失敗したら理由を出し、古い一覧を残さない', async () => {
    hoisted.listPageVersions.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/履歴を読み込めませんでした/);
    expect(result.current.versions).toHaveLength(0);
  });

  it('閉じてすぐ開き直しても、飛んでいる取得を使い回す（同じページの一覧を 2 回取らない）', async () => {
    let settleFirst: (value: unknown) => void = () => {};
    hoisted.listPageVersions.mockImplementationOnce(
      () => new Promise((resolve) => { settleFirst = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useKbPageVersions(SLUG, PAGE, open),
      { initialProps: { open: true } },
    );

    rerender({ open: false });
    rerender({ open: true });
    await act(async () => {
      settleFirst([version(2), version(1)]);
    });

    await waitFor(() => expect(result.current.versions.map((v) => v.seq)).toEqual([2, 1]));
    expect(hoisted.listPageVersions).toHaveBeenCalledTimes(1);
  });

  it('読み込めなかったら取り直せる', async () => {
    hoisted.listPageVersions.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.versions).toHaveLength(2));
    expect(result.current.error).toBeNull();
  });
});

describe('useKbPageVersions の作成（版を残す）', () => {
  it('成功したら応答の版を一覧の先頭へ足す', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.createVersion('リリース前の状態');
    });

    expect(hoisted.createPageVersion).toHaveBeenCalledWith(SLUG, PAGE, 'リリース前の状態');
    await waitFor(() => expect(result.current.versions.map((v) => v.seq)).toEqual([3, 2, 1]));
    expect(hoisted.listPageVersions).toHaveBeenCalledTimes(1);
  });

  it('パネルが閉じている（open=false）間は何もしない', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    await act(async () => {
      await result.current.createVersion('x');
    });

    expect(hoisted.createPageVersion).not.toHaveBeenCalled();
  });

  it('失敗は投げる。saving は元に戻り、一覧は変わらない', async () => {
    hoisted.createPageVersion.mockRejectedValue(new Error('forbidden'));
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await expect(
      act(async () => {
        await result.current.createVersion();
      }),
    ).rejects.toThrow();

    expect(result.current.saving).toBe(false);
    expect(result.current.versions).toHaveLength(2);
  });

  it('最初の読み込み中に版を残したら、残した 1 件だけの一覧を作らずに取り直す。古い取得結果でも上書きしない', async () => {
    let resolveFirst: (versions: ReturnType<typeof version>[]) => void = () => {};
    hoisted.listPageVersions
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue([version(3), version(2), version(1)]);
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));
    await waitFor(() => expect(hoisted.listPageVersions).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.createVersion();
    });
    await act(async () => {
      resolveFirst([]);
    });

    await waitFor(() => expect(result.current.versions.map((v) => v.seq)).toEqual([3, 2, 1]));
    expect(result.current.loading).toBe(false);
  });

  it('一覧を持っているうちの取り直しの途中で版を残しても、古い取得結果で足した版が消えない', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));
    await waitFor(() => expect(result.current.versions).toHaveLength(2));
    let resolveStale: (versions: ReturnType<typeof version>[]) => void = () => {};
    hoisted.listPageVersions.mockImplementationOnce(() => new Promise((resolve) => { resolveStale = resolve; }));
    act(() => result.current.retry());
    await waitFor(() => expect(hoisted.listPageVersions).toHaveBeenCalledTimes(2));

    await act(async () => {
      await result.current.createVersion();
    });
    await act(async () => {
      resolveStale([version(2), version(1)]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.versions.map((v) => v.seq)).toEqual([3, 2, 1]);
  });
});

describe('useKbPageVersions のプレビュー（selectVersion / clearSelection）', () => {
  it('selectVersion は doc 込みの詳細を取得する。open に依存しない', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    act(() => {
      result.current.selectVersion(1);
    });
    expect(result.current.selected).toMatchObject({ seq: 1, loading: true, detail: null });

    await waitFor(() => expect(result.current.selected?.loading).toBe(false));
    expect(hoisted.getPageVersion).toHaveBeenCalledWith(SLUG, PAGE, 1);
    expect(result.current.selected?.detail).toEqual(detail(1));
  });

  it('失敗したら理由を出す', async () => {
    hoisted.getPageVersion.mockRejectedValue(new Error('not found'));
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    act(() => {
      result.current.selectVersion(1);
    });

    await waitFor(() => expect(result.current.selected?.loading).toBe(false));
    expect(result.current.selected?.error).toMatch(/読み込めませんでした/);
    expect(result.current.selected?.detail).toBeNull();
  });

  it('別の版を選び直すと、古い方の応答が遅れて着地しても上書きしない', async () => {
    let settleFirst: (value: unknown) => void = () => {};
    hoisted.getPageVersion.mockImplementationOnce(
      () => new Promise((resolve) => { settleFirst = resolve; }),
    );
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    act(() => {
      result.current.selectVersion(1);
    });
    hoisted.getPageVersion.mockResolvedValue(detail(2));
    act(() => {
      result.current.selectVersion(2);
    });
    await waitFor(() => expect(result.current.selected?.loading).toBe(false));
    expect(result.current.selected?.seq).toBe(2);

    await act(async () => {
      settleFirst(detail(1));
    });
    expect(result.current.selected?.seq).toBe(2);
    expect(result.current.selected?.detail).toEqual(detail(2));
  });

  it('clearSelection で「現在の版に戻る」。飛んでいる取得も無効化する', async () => {
    let settle: (value: unknown) => void = () => {};
    hoisted.getPageVersion.mockImplementationOnce(
      () => new Promise((resolve) => { settle = resolve; }),
    );
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    act(() => {
      result.current.selectVersion(1);
    });
    act(() => {
      result.current.clearSelection();
    });
    expect(result.current.selected).toBeNull();

    await act(async () => {
      settle(detail(1));
    });
    // 閉じた後に届いた応答では復活しない。
    expect(result.current.selected).toBeNull();
  });

  it('ページを離れるとプレビューを畳む', async () => {
    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string | undefined }) => useKbPageVersions(SLUG, pageId, false),
      { initialProps: { pageId: PAGE as string | undefined } },
    );
    act(() => {
      result.current.selectVersion(1);
    });
    await waitFor(() => expect(result.current.selected?.loading).toBe(false));

    rerender({ pageId: 'p2' });

    expect(result.current.selected).toBeNull();
  });

  it('パネルの開閉（open）だけでは畳まない（プレビューはパネルの開閉と独立に生きる）', async () => {
    const { result, rerender } = renderHook(
      ({ open }: { open: boolean }) => useKbPageVersions(SLUG, PAGE, open),
      { initialProps: { open: true } },
    );
    act(() => {
      result.current.selectVersion(1);
    });
    await waitFor(() => expect(result.current.selected?.loading).toBe(false));

    rerender({ open: false });

    expect(result.current.selected?.seq).toBe(1);
  });
});

describe('useKbPageVersions の復元（restoreVersion）', () => {
  it('復元 API を呼び、成功したらプレビューを終える', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));
    act(() => {
      result.current.selectVersion(1);
    });
    await waitFor(() => expect(result.current.selected?.loading).toBe(false));

    let response: Awaited<ReturnType<typeof result.current.restoreVersion>> | undefined;
    await act(async () => {
      response = await result.current.restoreVersion(1);
    });

    expect(hoisted.restorePageVersion).toHaveBeenCalledWith(SLUG, PAGE, 1);
    expect(response?.lastEditedAt).toBe('2026-09-06T00:00:00Z');
    expect(result.current.selected).toBeNull();
    expect(result.current.restoring).toBe(false);
  });

  it('パネルが開いていれば、復元自体が新しい版になるため一覧を引き直す', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, true));
    await waitFor(() => expect(result.current.loading).toBe(false));
    hoisted.listPageVersions.mockClear();
    hoisted.listPageVersions.mockResolvedValue([version(3), version(2), version(1)]);

    await act(async () => {
      await result.current.restoreVersion(1);
    });

    await waitFor(() => expect(result.current.versions.map((v) => v.seq)).toEqual([3, 2, 1]));
    expect(hoisted.listPageVersions).toHaveBeenCalledWith(SLUG, PAGE);
  });

  it('パネルが閉じていれば一覧は引き直さない（次に開いたときの取得に任せる）', async () => {
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    await act(async () => {
      await result.current.restoreVersion(1);
    });

    expect(hoisted.listPageVersions).not.toHaveBeenCalled();
  });

  it('失敗は投げる。restoring は元に戻る', async () => {
    hoisted.restorePageVersion.mockRejectedValue(new Error('forbidden'));
    const { result } = renderHook(() => useKbPageVersions(SLUG, PAGE, false));

    await expect(
      act(async () => {
        await result.current.restoreVersion(1);
      }),
    ).rejects.toThrow();

    expect(result.current.restoring).toBe(false);
  });

  it('ページが確定していなければ投げる', async () => {
    const { result } = renderHook(() => useKbPageVersions(undefined, undefined, false));

    await expect(result.current.restoreVersion(1)).rejects.toThrow();
    expect(hoisted.restorePageVersion).not.toHaveBeenCalled();
  });
});
