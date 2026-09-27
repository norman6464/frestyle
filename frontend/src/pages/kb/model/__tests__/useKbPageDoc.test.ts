import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AxiosError, AxiosHeaders } from 'axios';
import { queryWrapper } from '@/test/queryClient';
import { useKbPageDoc } from '../useKbPageDoc';

// 木の控えを直すのに共有の置き場を使うので、置き場の中で描く（テストごとに新しい置き場）。
const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

function blockIdConflictError(): AxiosError {
  return new AxiosError('Conflict', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 409,
    statusText: 'Conflict',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: 'block_id_conflict' },
  });
}

const hoisted = vi.hoisted(() => ({
  resolvePage: vi.fn(),
  replaceContent: vi.fn(),
  renamePage: vi.fn(),
  setPageIcon: vi.fn(),
  clearPageIcon: vi.fn(),
  setPageCover: vi.fn(),
  clearPageCover: vi.fn(),
  reflect: vi.fn(),
  rememberVisitedPage: vi.fn(),
  forgetVisitedPageIfMatches: vi.fn(),
}));

vi.mock('@/entities/kb', () => ({
  KbRepository: {
    resolvePage: hoisted.resolvePage,
    replaceContent: hoisted.replaceContent,
    renamePage: hoisted.renamePage,
    setPageIcon: hoisted.setPageIcon,
    clearPageIcon: hoisted.clearPageIcon,
    setPageCover: hoisted.setPageCover,
    clearPageCover: hoisted.clearPageCover,
  },
  reflectKbPageInTrees: hoisted.reflect,
  rememberVisitedPage: hoisted.rememberVisitedPage,
  forgetVisitedPageIfMatches: hoisted.forgetVisitedPageIfMatches,
}));

const resolved = (title: string, canEdit = true) => ({
  workspaceSlug: 'w-3f2a9c',
  page: {
    id: 'p1',
    spaceId: 's1',
    title,
    createdByUserId: 1,
    createdAt: '2026-08-01T00:00:00Z',
    updatedAt: '2026-08-01T00:00:00Z',
  },
  doc: { type: 'doc', content: [] },
  canEdit,
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.resolvePage.mockResolvedValue(resolved('設計メモ'));
  hoisted.replaceContent.mockResolvedValue({ doc: { type: 'doc', content: [] }, builtAt: '2026-08-27T00:00:00Z' });
});

describe('useKbPageDoc', () => {
  it('ページ ID が無ければ何も取りに行かない', () => {
    renderHook(() => useKbPageDoc(undefined));

    expect(hoisted.resolvePage).not.toHaveBeenCalled();
  });

  it('ID だけでページと所属ワークスペースを解決する', async () => {
    const { result } = renderHook(() => useKbPageDoc('p1'));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data?.page.title).toBe('設計メモ');
    expect(result.current.data?.workspaceSlug).toBe('w-3f2a9c');
    expect(result.current.data?.canEdit).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('失敗しても「見る権限がありません」とは言わない', async () => {
    // backend は「無い」と「見えない」を撃ち分けていない（撃ち分けると ID の総当たりで
    // 実在が分かる）。フロントで名指しすると、そこだけが隠していることを喋る。
    hoisted.resolvePage.mockRejectedValue(new Error('404'));

    const { result } = renderHook(() => useKbPageDoc('p1'));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).not.toMatch(/権限/);
    expect(result.current.data).toBeNull();
  });

  it('開けたら「最後に開いたページ」として覚える(ヘッダーのナレッジボタン用)', async () => {
    renderHook(() => useKbPageDoc('p1'));

    await waitFor(() => expect(hoisted.rememberVisitedPage).toHaveBeenCalledWith('p1'));
  });

  it('開けなかったら、覚えていたのが同じページなら忘れる', async () => {
    hoisted.resolvePage.mockRejectedValue(new Error('404'));

    renderHook(() => useKbPageDoc('p1'));

    await waitFor(() => expect(hoisted.forgetVisitedPageIfMatches).toHaveBeenCalledWith('p1'));
    expect(hoisted.rememberVisitedPage).not.toHaveBeenCalled();
  });

  it('速く行き来しても、古い応答が新しいページを上書きしない', async () => {
    let resolveOld: (value: unknown) => void = () => {};
    hoisted.resolvePage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );

    const { result, rerender } = renderHook(({ id }) => useKbPageDoc(id), {
      initialProps: { id: 'old' },
    });

    hoisted.resolvePage.mockResolvedValue(resolved('新しいページ'));
    rerender({ id: 'new' });
    await waitFor(() => expect(result.current.data?.page.title).toBe('新しいページ'));

    // 先に投げた要求がいま返ってくる。後から届いても採用してはいけない。
    //
    // act で包んで**解決を実際に流し切ってから**確かめる。ここを waitFor にすると、
    // 最初の判定が古い応答の反映より先に走って必ず通り、検査として意味を成さない。
    await act(async () => {
      resolveOld(resolved('古いページ'));
    });
    expect(result.current.data?.page.title).toBe('新しいページ');
  });

  it('書くとデバウンス後に保存し、状態が unsaved → saving → saved と動く', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useKbPageDoc('p1'));

      // 解決を流し切る（fake timer 下なので waitFor は使わない）。
      await act(async () => {});
      expect(result.current.data).not.toBeNull();

      act(() => {
        result.current.onDocChange({ type: 'doc', content: [{ type: 'paragraph' }] });
      });
      expect(result.current.saveStatus).toBe('unsaved');
      expect(hoisted.replaceContent).not.toHaveBeenCalled();

      // デバウンスの間合いを越えると 1 回だけ保存が飛ぶ。
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(hoisted.replaceContent).toHaveBeenCalledTimes(1);
      expect(hoisted.replaceContent).toHaveBeenCalledWith(
        'w-3f2a9c',
        'p1',
        { type: 'doc', content: [{ type: 'paragraph' }] },
      );
      expect(result.current.saveStatus).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('本文保存の応答で lastEditedBy / lastEditedAt を更新する（画面は現在ユーザーの名前を持たない）', async () => {
    vi.useFakeTimers();
    try {
      hoisted.replaceContent.mockResolvedValue({
        doc: { type: 'doc', content: [] },
        builtAt: '2026-09-06T00:00:00Z',
        lastEditedBy: { userId: 1, name: '田中 太郎' },
        lastEditedAt: '2026-09-06T00:00:00Z',
      });
      const { result } = renderHook(() => useKbPageDoc('p1'));
      await act(async () => {});

      act(() => {
        result.current.onDocChange({ type: 'doc', content: [] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.data?.lastEditedBy).toEqual({ userId: 1, name: '田中 太郎' });
      expect(result.current.data?.lastEditedAt).toBe('2026-09-06T00:00:00Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('離れたページの保存応答は、いま見ているページに反映しない', async () => {
    vi.useFakeTimers();
    try {
      let resolvePut: (value: unknown) => void = () => {};
      hoisted.replaceContent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePut = resolve;
          }),
      );

      const { result, rerender } = renderHook(({ id }) => useKbPageDoc(id), {
        initialProps: { id: 'p1' },
      });
      await act(async () => {});

      // p1 で書く → PUT(p1) が飛ぶ（保留のまま）。
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [{ type: 'paragraph' }] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      // p2 へ移る。
      hoisted.resolvePage.mockResolvedValue({
        ...resolved('子ページ'),
        page: { ...resolved('子ページ').page, id: 'p2' },
      });
      rerender({ id: 'p2' });
      await act(async () => {});

      // PUT(p1) の応答がいま届いても、p2 の lastEditedBy は変わらない。
      await act(async () => {
        resolvePut({
          doc: { type: 'doc', content: [] },
          builtAt: '2026-09-06T00:00:00Z',
          lastEditedBy: { userId: 1, name: '田中 太郎' },
          lastEditedAt: '2026-09-06T00:00:00Z',
        });
      });
      expect(result.current.data?.page.id).toBe('p2');
      expect(result.current.data?.lastEditedBy).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('前の保存が終わるまで次の PUT を送らない（丸ごと置換なので順序が命）', async () => {
    // 並行に送ると、後から書いた本文の PUT が先に完了し、古い本文の PUT が
    // 後から着地して上書きし得る。送信は必ず 1 本ずつ・編集順で。
    vi.useFakeTimers();
    try {
      let resolveFirst: (value: unknown) => void = () => {};
      hoisted.replaceContent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      );

      const { result } = renderHook(() => useKbPageDoc('p1'));
      await act(async () => {});

      // 1 回目の編集 → デバウンス発火で PUT(A) が飛ぶ（保留のまま）。
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [{ type: 'paragraph' }] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(hoisted.replaceContent).toHaveBeenCalledTimes(1);

      // PUT(A) が飛んでいる間に 2 回目の編集 → デバウンスが切れても送らない。
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(hoisted.replaceContent).toHaveBeenCalledTimes(1);

      // PUT(A) が完了したら、残っていた本文が続けて送られる。
      await act(async () => {
        resolveFirst({ doc: { type: 'doc', content: [] }, builtAt: '2026-08-28T00:00:00Z' });
      });
      expect(hoisted.replaceContent).toHaveBeenCalledTimes(2);
      expect(hoisted.replaceContent).toHaveBeenLastCalledWith('w-3f2a9c', 'p1', {
        type: 'doc',
        content: [],
      });
      expect(result.current.saveStatus).toBe('saved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renameTitle は改名し、画面の題名を確定後の値へ差し替え、木の控えも差し替える', async () => {
    const renamed = {
      id: 'p1',
      spaceId: 's1',
      title: '設計メモ v2',
      createdByUserId: 1,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    };
    hoisted.renamePage.mockResolvedValue(renamed);
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.renameTitle('設計メモ v2');
    });

    expect(hoisted.renamePage).toHaveBeenCalledWith('w-3f2a9c', 'p1', '設計メモ v2');
    expect(result.current.data?.page.title).toBe('設計メモ v2');
    expect(hoisted.reflect).toHaveBeenCalledWith(expect.anything(), 'w-3f2a9c', renamed);
  });

  it('renameTitle の失敗は投げ、画面の題名は変えない', async () => {
    hoisted.renamePage.mockRejectedValue(new Error('403'));
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await expect(result.current.renameTitle('だめな改名')).rejects.toThrow();
    expect(result.current.data?.page.title).toBe('設計メモ');
    expect(hoisted.reflect).not.toHaveBeenCalled();
  });

  it('changeIcon は設定すると page.icon を確定後の値へ差し替え、木の控えも差し替える', async () => {
    const withIcon = {
      id: 'p1',
      spaceId: 's1',
      title: '設計メモ',
      createdByUserId: 1,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
      icon: { type: 'emoji', value: '📘' },
    };
    hoisted.setPageIcon.mockResolvedValue(withIcon);
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.changeIcon({ type: 'emoji', value: '📘' });
    });

    expect(hoisted.setPageIcon).toHaveBeenCalledWith('w-3f2a9c', 'p1', {
      type: 'emoji',
      value: '📘',
    });
    expect(result.current.data?.page.icon).toEqual({ type: 'emoji', value: '📘' });
    expect(hoisted.reflect).toHaveBeenCalledWith(expect.anything(), 'w-3f2a9c', withIcon);
  });

  it('changeIcon は null で解除する（clearPageIcon を呼ぶ）', async () => {
    const cleared = {
      id: 'p1',
      spaceId: 's1',
      title: '設計メモ',
      createdByUserId: 1,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
      icon: null,
    };
    hoisted.clearPageIcon.mockResolvedValue(cleared);
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.changeIcon(null);
    });

    expect(hoisted.clearPageIcon).toHaveBeenCalledWith('w-3f2a9c', 'p1');
    expect(hoisted.setPageIcon).not.toHaveBeenCalled();
    expect(result.current.data?.page.icon).toBeNull();
  });

  it('changeIcon の失敗は投げ、画面のアイコンは変えない', async () => {
    hoisted.setPageIcon.mockRejectedValue(new Error('invalid_icon'));
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await expect(
      result.current.changeIcon({ type: 'emoji', value: 'x' }),
    ).rejects.toThrow();
    expect(result.current.data?.page.icon).toBeUndefined();
    expect(hoisted.reflect).not.toHaveBeenCalled();
  });

  it('changeCover は key を設定すると page・cover を確定後の値へ差し替え、木の控えも差し替える', async () => {
    const page = {
      id: 'p1',
      spaceId: 's1',
      title: '設計メモ',
      createdByUserId: 1,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    };
    const cover = { type: 'file' as const, url: 'https://s3/signed?sig=1' };
    hoisted.setPageCover.mockResolvedValue({ page, cover });
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.changeCover('kb/w-1/p1/1.bin');
    });

    expect(hoisted.setPageCover).toHaveBeenCalledWith('w-3f2a9c', 'p1', 'kb/w-1/p1/1.bin');
    expect(result.current.data?.cover).toEqual(cover);
    expect(hoisted.reflect).toHaveBeenCalledWith(expect.anything(), 'w-3f2a9c', page);
  });

  it('changeCover は null で解除する（clearPageCover を呼ぶ）', async () => {
    const page = {
      id: 'p1',
      spaceId: 's1',
      title: '設計メモ',
      createdByUserId: 1,
      createdAt: '2026-08-01T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    };
    hoisted.clearPageCover.mockResolvedValue({ page, cover: null });
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.changeCover(null);
    });

    expect(hoisted.clearPageCover).toHaveBeenCalledWith('w-3f2a9c', 'p1');
    expect(hoisted.setPageCover).not.toHaveBeenCalled();
    expect(result.current.data?.cover).toBeNull();
  });

  it('changeCover の失敗は投げ、画面のカバーは変えない', async () => {
    hoisted.setPageCover.mockRejectedValue(new Error('invalid_cover'));
    const { result } = renderHook(() => useKbPageDoc('p1'));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await expect(result.current.changeCover('kb/w-1/p1/1.bin')).rejects.toThrow();
    expect(result.current.data?.cover).toBeUndefined();
    expect(hoisted.reflect).not.toHaveBeenCalled();
  });

  it('ページを移っても、書きかけの保存は**書いた時点のページ**へ送る（移った先を潰さない）', async () => {
    // 旧: 宛先を送信時に読む → 移った先の resolve が宛先を差し替え、旧ページの全文が
    // 新ページへ PUT され、丸ごと置換なので新ページの本文が消えていた。
    vi.useFakeTimers();
    try {
      let resolveFirstPut: (value: unknown) => void = () => {};
      hoisted.replaceContent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstPut = resolve;
          }),
      );

      const { result, rerender } = renderHook(({ id }) => useKbPageDoc(id), {
        initialProps: { id: 'p1' },
      });
      await act(async () => {});

      // p1 で書く → PUT(A) が飛ぶ（保留）。さらに書いて残りを作る。
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [{ type: 'paragraph' }] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [] });
      });

      // 子ページ p2 へ移る（resolve は p2 を返し、宛先 ref は p2 に差し替わる）。
      hoisted.resolvePage.mockResolvedValue({
        ...resolved('子ページ'),
        page: { ...resolved('子ページ').page, id: 'p2' },
      });
      rerender({ id: 'p2' });
      await act(async () => {});

      // PUT(A) が完了 → 残りが流れる。宛先は**書いた時点の p1** でなければならない。
      await act(async () => {
        resolveFirstPut({ doc: { type: 'doc', content: [] }, builtAt: '2026-08-28T00:00:00Z' });
      });
      expect(hoisted.replaceContent).toHaveBeenCalledTimes(2);
      expect(hoisted.replaceContent).toHaveBeenLastCalledWith('w-3f2a9c', 'p1', {
        type: 'doc',
        content: [],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('改名の応答が別ページへ移った後に返っても、移った先の表示を上書きしない', async () => {
    let resolveRename: (value: unknown) => void = () => {};
    hoisted.renamePage.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRename = resolve;
        }),
    );
    const { result, rerender } = renderHook(({ id }) => useKbPageDoc(id), {
      initialProps: { id: 'p1' },
    });
    await waitFor(() => expect(result.current.data).not.toBeNull());

    // p1 の改名を送ったまま p2 へ移る。
    const renamePromise = result.current.renameTitle('旧ページの新題名');
    hoisted.resolvePage.mockResolvedValue({
      ...resolved('別ページ'),
      page: { ...resolved('別ページ').page, id: 'p2' },
    });
    rerender({ id: 'p2' });
    await waitFor(() => expect(result.current.data?.page.id).toBe('p2'));

    // 遅れて p1 の改名応答が着地しても、p2 の表示はそのまま。
    await act(async () => {
      resolveRename({
        id: 'p1',
        spaceId: 's1',
        title: '旧ページの新題名',
        createdByUserId: 1,
        createdAt: '2026-08-01T00:00:00Z',
        updatedAt: '2026-08-28T00:00:00Z',
      });
      await renamePromise;
    });
    expect(result.current.data?.page.id).toBe('p2');
    expect(result.current.data?.page.title).toBe('別ページ');
    // 改名自体はサーバーで成立しているので、木の控えは差し替える（宛先は改名した旧ページ）。
    expect(hoisted.reflect).toHaveBeenCalledWith(
      expect.anything(),
      'w-3f2a9c',
      expect.objectContaining({ id: 'p1', title: '旧ページの新題名' }),
    );
  });

  it('旧ページの書き直しは、移った先で書いても消えない（宛先ごとに保留を持つ）', async () => {
    // 1 枠の保留だと、p1 の PUT 中に p1 を書き直し → p2 へ移動 → p2 を書く、の並びで
    // p2 の doc が p1 の保留を上書きし、p1 の最後の編集が黙って消えていた。
    vi.useFakeTimers();
    try {
      let resolveFirstPut: (value: unknown) => void = () => {};
      hoisted.replaceContent.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirstPut = resolve;
          }),
      );

      const { result, rerender } = renderHook(({ id }) => useKbPageDoc(id), {
        initialProps: { id: 'p1' },
      });
      await act(async () => {});

      // p1 で書く → PUT(p1 v1) が飛ぶ（保留）。飛行中に p1 を書き直す。
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [{ type: 'paragraph' }] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [], attrs: { v: 'p1v2' } });
      });

      // p2 へ移って p2 も書く。
      hoisted.resolvePage.mockResolvedValue({
        ...resolved('子ページ'),
        page: { ...resolved('子ページ').page, id: 'p2' },
      });
      rerender({ id: 'p2' });
      await act(async () => {});
      act(() => {
        result.current.onDocChange({ type: 'doc', content: [], attrs: { v: 'p2v1' } });
      });

      // PUT(p1 v1) が完了すると、p1 の書き直しと p2 の両方が書いた順で届く。
      await act(async () => {
        resolveFirstPut({ doc: { type: 'doc', content: [] }, builtAt: '2026-08-28T00:00:00Z' });
        vi.advanceTimersByTime(1000);
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(hoisted.replaceContent).toHaveBeenCalledTimes(3);
      expect(hoisted.replaceContent).toHaveBeenNthCalledWith(2, 'w-3f2a9c', 'p1', {
        type: 'doc',
        content: [],
        attrs: { v: 'p1v2' },
      });
      expect(hoisted.replaceContent).toHaveBeenNthCalledWith(3, 'w-3f2a9c', 'p2', {
        type: 'doc',
        content: [],
        attrs: { v: 'p2v1' },
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('保存が失敗したら unsaved に戻す（保存できた顔をしない）', async () => {
    vi.useFakeTimers();
    try {
      hoisted.replaceContent.mockRejectedValue(new Error('500'));
      const { result } = renderHook(() => useKbPageDoc('p1'));
      await act(async () => {});

      act(() => {
        result.current.onDocChange({ type: 'doc', content: [] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.saveStatus).toBe('unsaved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('保存がblock_id_conflictで失敗したらcontentConflictCountを増やす', async () => {
    vi.useFakeTimers();
    try {
      hoisted.replaceContent.mockRejectedValue(blockIdConflictError());
      const { result } = renderHook(() => useKbPageDoc('p1'));
      await act(async () => {});
      expect(result.current.contentConflictCount).toBe(0);

      act(() => {
        result.current.onDocChange({ type: 'doc', content: [] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.contentConflictCount).toBe(1);
      expect(result.current.saveStatus).toBe('unsaved');
    } finally {
      vi.useRealTimers();
    }
  });

  it('block_id_conflict以外の失敗ではcontentConflictCountを増やさない', async () => {
    vi.useFakeTimers();
    try {
      hoisted.replaceContent.mockRejectedValue(new Error('500'));
      const { result } = renderHook(() => useKbPageDoc('p1'));
      await act(async () => {});

      act(() => {
        result.current.onDocChange({ type: 'doc', content: [] });
      });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });

      expect(result.current.contentConflictCount).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  describe('applyRestoredContent（版の復元の反映）', () => {
    it('doc / lastEditedBy / lastEditedAt を確定後の値へ差し替える（API 自体は呼ばない）', async () => {
      const { result } = renderHook(() => useKbPageDoc('p1'));
      await act(async () => {});

      act(() => {
        result.current.applyRestoredContent('p1', {
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
          builtAt: '2026-09-06T00:00:00Z',
          lastEditedBy: { userId: 1, name: '田中 太郎' },
          lastEditedAt: '2026-09-06T00:00:00Z',
        });
      });

      expect(result.current.data?.doc).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
      expect(result.current.data?.lastEditedBy).toEqual({ userId: 1, name: '田中 太郎' });
      expect(result.current.data?.lastEditedAt).toBe('2026-09-06T00:00:00Z');
      // 復元自体は本文保存 API（replaceContent）を呼ばない — 叩くのは
      // useKbPageVersions.restoreVersion 側で、ここは応答を反映するだけ。
      expect(hoisted.replaceContent).not.toHaveBeenCalled();
    });

    it('宛先が今のページと違えば何もしない（別ページへ移った後に届いた復元応答を反映しない）', async () => {
      const { result, rerender } = renderHook(({ id }) => useKbPageDoc(id), {
        initialProps: { id: 'p1' },
      });
      await act(async () => {});

      hoisted.resolvePage.mockResolvedValue({
        ...resolved('子ページ'),
        page: { ...resolved('子ページ').page, id: 'p2' },
      });
      rerender({ id: 'p2' });
      await act(async () => {});

      act(() => {
        // p1 で始まった復元が、p2 へ移った後に届いた想定。
        result.current.applyRestoredContent('p1', {
          doc: { type: 'doc', content: [{ type: 'paragraph' }] },
          builtAt: '2026-09-06T00:00:00Z',
          lastEditedBy: { userId: 1, name: '田中 太郎' },
          lastEditedAt: '2026-09-06T00:00:00Z',
        });
      });

      expect(result.current.data?.page.id).toBe('p2');
      expect(result.current.data?.lastEditedBy).toBeUndefined();
    });
  });

  describe('waitForPendingSaveToSettle（復元前に自動保存を片づける）', () => {
    // CodeRabbit 指摘の回帰確認。復元は API 呼び出しの経路が自動保存（PUT .../content）とは
    // 別（POST .../versions/:seq/restore）なので、待たずに復元だけ叩くと、先に飛んでいた
    // 自動保存の応答が復元の**後**に着地して、復元した古い内容を打鍵済みの内容で
    // 上書きしてしまう競合があった。waitForPendingSaveToSettle はこれを防ぐ。
    it('進行中のPUTが終わるまで待つ（先に片づけてから復元するので、後から自動保存が上書きしない）', async () => {
      vi.useFakeTimers();
      try {
        let resolvePut: (value: unknown) => void = () => {};
        hoisted.replaceContent.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolvePut = resolve;
            }),
        );

        const { result } = renderHook(() => useKbPageDoc('p1'));
        await act(async () => {});

        // 打鍵 → デバウンス満了で PUT(p1) が飛ぶ（まだ応答が無い＝進行中）。
        act(() => {
          result.current.onDocChange({ type: 'doc', content: [{ type: 'paragraph' }] });
        });
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
        expect(result.current.saveStatus).toBe('saving');

        // 復元の直前に呼ぶ想定。進行中の PUT が片づくまで待つ。
        let settled = false;
        const waitPromise = result.current.waitForPendingSaveToSettle('p1').then(() => {
          settled = true;
        });
        // まだ PUT の応答を返していないので、待っている最中のはず。
        await act(async () => {
          await Promise.resolve();
        });
        expect(settled).toBe(false);

        // PUT の応答が届く → waitForPendingSaveToSettle が解決する。
        await act(async () => {
          resolvePut({
            doc: { type: 'doc', content: [{ type: 'paragraph' }] },
            builtAt: '2026-09-08T00:00:00Z',
            lastEditedBy: { userId: 1, name: '田中 太郎' },
            lastEditedAt: '2026-09-08T00:00:00Z',
          });
          await waitPromise;
        });
        expect(settled).toBe(true);

        // ここで復元の応答を反映しても、後から追いつく自動保存の応答が無い
        // （待っている間に片づいた PUT がこの内容を上書きし得ない）。
        act(() => {
          result.current.applyRestoredContent('p1', {
            doc: { type: 'doc', content: [] },
            builtAt: '2026-09-08T00:01:00Z',
            lastEditedBy: { userId: 2, name: '鈴木 花子' },
            lastEditedAt: '2026-09-08T00:01:00Z',
          });
        });
        expect(result.current.data?.doc).toEqual({ type: 'doc', content: [] });
        expect(result.current.data?.lastEditedBy).toEqual({ userId: 2, name: '鈴木 花子' });
      } finally {
        vi.useRealTimers();
      }
    });

    it('デバウンス待ちの保留（まだPUTを送っていない書きかけ）は捨てる。復元後に勝手に送られない', async () => {
      vi.useFakeTimers();
      try {
        const { result } = renderHook(() => useKbPageDoc('p1'));
        await act(async () => {});

        // 打鍵はしたが、デバウンス（800ms）が満了する前。まだ PUT は飛んでいない。
        act(() => {
          result.current.onDocChange({ type: 'doc', content: [{ type: 'paragraph' }] });
        });
        expect(hoisted.replaceContent).not.toHaveBeenCalled();

        await act(async () => {
          await result.current.waitForPendingSaveToSettle('p1');
        });

        // タイマーが満了しても、保留は既に捨てられているので PUT は飛ばない。
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
        expect(hoisted.replaceContent).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
