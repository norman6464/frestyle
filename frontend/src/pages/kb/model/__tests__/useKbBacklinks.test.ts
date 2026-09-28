import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryWrapper } from '@/test/queryClient';
import { useKbBacklinks } from '../useKbBacklinks';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const hoisted = vi.hoisted(() => ({
  listBacklinks: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    listBacklinks: hoisted.listBacklinks,
  },
}));

const SLUG = 'w-3f2a9c';
const PAGE = 'p1';

const backlink = (id: string, title: string) => ({
  id,
  spaceId: 's1',
  title,
  createdByUserId: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listBacklinks.mockResolvedValue([backlink('p-ref-1', '参照元ページ')]);
});

describe('useKbBacklinks', () => {
  it('workspaceSlug/pageId のどちらかが欠けていれば取りに行かない', () => {
    renderHook(() => useKbBacklinks(undefined, undefined));

    expect(hoisted.listBacklinks).not.toHaveBeenCalled();
  });

  it('pageId だけ欠けていても取りに行かない', () => {
    renderHook(() => useKbBacklinks(SLUG, undefined));

    expect(hoisted.listBacklinks).not.toHaveBeenCalled();
  });

  it('workspaceSlug と pageId が揃うと、折りたたみの開閉に関わらず取得する', async () => {
    const { result } = renderHook(() => useKbBacklinks(SLUG, PAGE));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.listBacklinks).toHaveBeenCalledWith(SLUG, PAGE);
    expect(result.current.pages).toEqual([backlink('p-ref-1', '参照元ページ')]);
    expect(result.current.error).toBeNull();
  });

  it('0 件でも空配列のまま失敗にはしない', async () => {
    hoisted.listBacklinks.mockResolvedValue([]);
    const { result } = renderHook(() => useKbBacklinks(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.pages).toEqual([]);
    expect(result.current.error).toBeNull();
  });

  it('読み込みに失敗したら理由を出し、一覧は空にする', async () => {
    hoisted.listBacklinks.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useKbBacklinks(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/参照しているページを読み込めませんでした/);
    expect(result.current.pages).toEqual([]);
  });

  it('読み込めなかったら取り直せる', async () => {
    hoisted.listBacklinks.mockRejectedValueOnce(new Error('boom'));
    const { result } = renderHook(() => useKbBacklinks(SLUG, PAGE));
    await waitFor(() => expect(result.current.error).not.toBeNull());

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });
});

describe('useKbBacklinks の宛先チェック', () => {
  it('ページ未確定へ戻ると一覧を畳む（次にページが決まった瞬間に前のページの一覧が一瞬出ない）', async () => {
    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string | undefined }) => useKbBacklinks(SLUG, pageId),
      { initialProps: { pageId: PAGE as string | undefined } },
    );
    await waitFor(() => expect(result.current.pages).toHaveLength(1));

    rerender({ pageId: undefined });

    expect(result.current.pages).toEqual([]);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('応答が返る前に別ページへ移っていたら、古い応答で新しいページの状態を上書きしない', async () => {
    let settleOld: (pages: ReturnType<typeof backlink>[]) => void = () => {};
    hoisted.listBacklinks.mockImplementationOnce(
      () => new Promise((resolve) => { settleOld = resolve; }),
    );
    hoisted.listBacklinks.mockResolvedValue([backlink('p-new', '新しいページの参照元')]);

    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string }) => useKbBacklinks(SLUG, pageId),
      { initialProps: { pageId: 'p-old' } },
    );

    rerender({ pageId: 'p-new' });
    await waitFor(() => expect(result.current.pages).toHaveLength(1));
    expect(result.current.pages[0].id).toBe('p-new');

    // 遅れて着地した旧ページの応答は捨てる。
    await act(async () => {
      settleOld([backlink('p-old-ref', '旧ページの参照元')]);
    });
    expect(result.current.pages.map((p) => p.id)).toEqual(['p-new']);
  });

  it('ページ未確定へ戻ったあとに着地した読み込み応答は捨てる', async () => {
    let settle: (pages: ReturnType<typeof backlink>[]) => void = () => {};
    hoisted.listBacklinks.mockImplementationOnce(
      () => new Promise((resolve) => { settle = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string | undefined }) => useKbBacklinks(SLUG, pageId),
      { initialProps: { pageId: PAGE as string | undefined } },
    );
    rerender({ pageId: undefined });

    await act(async () => {
      settle([backlink('p-ref-1', '参照元ページ')]);
    });

    expect(result.current.pages).toEqual([]);
    expect(result.current.loading).toBe(false);
  });
});
