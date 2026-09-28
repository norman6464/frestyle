import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryWrapper } from '@/test/queryClient';
import { useKbComments } from '../useKbComments';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const hoisted = vi.hoisted(() => ({
  listCommentThreads: vi.fn(),
  createCommentThread: vi.fn(),
  addComment: vi.fn(),
  resolveCommentThread: vi.fn(),
  reopenCommentThread: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    listCommentThreads: hoisted.listCommentThreads,
    createCommentThread: hoisted.createCommentThread,
    addComment: hoisted.addComment,
    resolveCommentThread: hoisted.resolveCommentThread,
    reopenCommentThread: hoisted.reopenCommentThread,
  },
}));

const SLUG = 'w-3f2a9c';
const PAGE = 'p1';

const author = (name = '田中 太郎', userId = 1) => ({ userId, name });

const comment = (id: string, text: string) => ({
  id,
  author: author(),
  body: [{ type: 'text', text }],
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

const thread = (id: string, overrides: Partial<ReturnType<typeof baseThread>> = {}) => ({
  ...baseThread(id),
  ...overrides,
});

function baseThread(id: string) {
  return {
    id,
    createdBy: author(),
    resolvedAt: null as string | null,
    resolvedBy: null as null | ReturnType<typeof author>,
    createdAt: '2026-09-01T00:00:00Z',
    comments: [comment(`${id}-c1`, '質問です')],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listCommentThreads.mockResolvedValue([thread('t1')]);
  hoisted.createCommentThread.mockResolvedValue(thread('t2'));
  hoisted.addComment.mockResolvedValue(comment('t1-c2', '返信です'));
  hoisted.resolveCommentThread.mockResolvedValue(
    thread('t1', { resolvedAt: '2026-09-02T00:00:00Z', resolvedBy: author('鈴木 花子', 2) }),
  );
  hoisted.reopenCommentThread.mockResolvedValue(thread('t1'));
});

describe('useKbComments', () => {
  it('workspaceSlug/pageId のどちらかが欠けていれば取りに行かない', () => {
    renderHook(() => useKbComments(undefined, undefined));

    expect(hoisted.listCommentThreads).not.toHaveBeenCalled();
  });

  it('pageId だけ欠けていても取りに行かない', () => {
    renderHook(() => useKbComments(SLUG, undefined));

    expect(hoisted.listCommentThreads).not.toHaveBeenCalled();
  });

  it('workspaceSlug と pageId が揃うと、パネルの開閉に関わらず取得する', async () => {
    const { result } = renderHook(() => useKbComments(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.listCommentThreads).toHaveBeenCalledWith(SLUG, PAGE);
    expect(result.current.threads).toEqual([thread('t1')]);
  });

  it('読み込みに失敗したら理由を出し、古いスレッドを残さない', async () => {
    hoisted.listCommentThreads.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useKbComments(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/コメントを読み込めませんでした/);
    expect(result.current.threads).toHaveLength(0);
  });

  it('取り直しが 403（見る立場を失った）なら、持っているスレッドも出さずに失敗にする', async () => {
    const { result } = renderHook(() => useKbComments(SLUG, PAGE));
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    hoisted.listCommentThreads.mockRejectedValue(
      new AxiosError('forbidden', 'ERR_BAD_REQUEST', undefined, undefined, {
        status: 403,
        statusText: '',
        headers: {},
        config: { headers: new AxiosHeaders() },
        data: {},
      }),
    );
    act(() => result.current.retry());

    await waitFor(() => expect(result.current.error).toMatch(/コメントを読み込めませんでした/));
    expect(result.current.threads).toEqual([]);
  });

  it('取り直しが一時的な失敗なら、持っているスレッドは出したまま', async () => {
    const { result } = renderHook(() => useKbComments(SLUG, PAGE));
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    hoisted.listCommentThreads.mockRejectedValue(new Error('network'));
    act(() => result.current.retry());

    await waitFor(() => expect(hoisted.listCommentThreads).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 0));
    expect(result.current.threads).toHaveLength(1);
    expect(result.current.error).toBeNull();
  });

  describe('createThread', () => {
    it('成功したら応答のスレッドを末尾に足す', async () => {
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const body = [{ type: 'text', text: '新しいスレッド' }];
      await act(async () => {
        await result.current.createThread(body);
      });

      expect(hoisted.createCommentThread).toHaveBeenCalledWith(SLUG, PAGE, body, undefined);
      expect(result.current.threads.map((t) => t.id)).toEqual(['t1', 't2']);
    });

    it('anchor を渡すと、そのまま KbRepository.createCommentThread へ転送する（錨付きコメント）', async () => {
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      const body = [{ type: 'text', text: '選んだ文への質問' }];
      const anchor = { blockId: 'block-1', anchorFrom: 3, anchorTo: 9, quote: '選んだ文' };
      await act(async () => {
        await result.current.createThread(body, anchor);
      });

      expect(hoisted.createCommentThread).toHaveBeenCalledWith(SLUG, PAGE, body, anchor);
    });

    it('失敗は投げる。saving は元に戻り、一覧は変わらない', async () => {
      hoisted.createCommentThread.mockRejectedValue(new Error('forbidden'));
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.createThread([{ type: 'text', text: 'x' }]);
        }),
      ).rejects.toThrow();

      expect(result.current.saving).toBe(false);
      expect(result.current.threads).toHaveLength(1);
    });
  });

  describe('reply', () => {
    it('成功したら該当スレッドの comments に追加する（他のスレッドは変えない）', async () => {
      hoisted.listCommentThreads.mockResolvedValue([thread('t1'), thread('t2')]);
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.threads).toHaveLength(2));

      const body = [{ type: 'text', text: '返信です' }];
      await act(async () => {
        await result.current.reply('t1', body);
      });

      expect(hoisted.addComment).toHaveBeenCalledWith(SLUG, PAGE, 't1', body);
      const t1 = result.current.threads.find((t) => t.id === 't1');
      const t2 = result.current.threads.find((t) => t.id === 't2');
      expect(t1?.comments.map((c) => c.id)).toEqual(['t1-c1', 't1-c2']);
      expect(t2?.comments.map((c) => c.id)).toEqual(['t2-c1']);
    });

    it('失敗は投げる', async () => {
      hoisted.addComment.mockRejectedValue(new Error('forbidden'));
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.reply('t1', [{ type: 'text', text: 'x' }]);
        }),
      ).rejects.toThrow();
      expect(result.current.saving).toBe(false);
    });
  });

  describe('resolve / reopen', () => {
    it('resolve は応答の解決状態（resolvedAt / resolvedBy）だけを該当スレッドへ差し込む', async () => {
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.resolve('t1');
      });

      expect(hoisted.resolveCommentThread).toHaveBeenCalledWith(SLUG, PAGE, 't1');
      expect(result.current.threads[0].resolvedAt).toBe('2026-09-02T00:00:00Z');
      expect(result.current.threads[0].resolvedBy).toEqual(author('鈴木 花子', 2));
    });

    it('reopen は応答の解決状態だけを該当スレッドへ差し込む', async () => {
      hoisted.listCommentThreads.mockResolvedValue([
        thread('t1', { resolvedAt: '2026-09-02T00:00:00Z', resolvedBy: author('鈴木 花子', 2) }),
      ]);
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await act(async () => {
        await result.current.reopen('t1');
      });

      expect(hoisted.reopenCommentThread).toHaveBeenCalledWith(SLUG, PAGE, 't1');
      expect(result.current.threads[0].resolvedAt).toBeNull();
    });

    it('resolve/reopen の応答が空の comments を返しても、手元の発言一覧は消えない（サーバーは発言を引き直さない設計）', async () => {
      // 実際の backend は resolve/reopen の応答で comments を常に空配列で返す
      // （発言を引き直さない設計）。スレッドを丸ごと差し替えると、解決するたびに
      // 表示中の発言が消えてしまう — 解決状態の欄だけを差し込むことで防ぐ。
      hoisted.resolveCommentThread.mockResolvedValue(
        thread('t1', {
          resolvedAt: '2026-09-02T00:00:00Z',
          resolvedBy: author('鈴木 花子', 2),
          comments: [],
        }),
      );
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.threads[0].comments).toHaveLength(1));

      await act(async () => {
        await result.current.resolve('t1');
      });

      expect(result.current.threads[0].comments).toEqual([comment('t1-c1', '質問です')]);
      expect(result.current.threads[0].resolvedAt).toBe('2026-09-02T00:00:00Z');
    });

    it('失敗は投げる', async () => {
      hoisted.resolveCommentThread.mockRejectedValue(new Error('forbidden'));
      const { result } = renderHook(() => useKbComments(SLUG, PAGE));
      await waitFor(() => expect(result.current.loading).toBe(false));

      await expect(
        act(async () => {
          await result.current.resolve('t1');
        }),
      ).rejects.toThrow();
      expect(result.current.saving).toBe(false);
    });
  });
});

describe('useKbComments の宛先', () => {
  it('宛先が無くなったら状態を畳む（次にページが決まったとき前のページのスレッドを出さない）', async () => {
    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string | undefined }) => useKbComments(SLUG, pageId),
      { initialProps: { pageId: PAGE as string | undefined } },
    );
    await waitFor(() => expect(result.current.threads).toHaveLength(1));

    rerender({ pageId: undefined });

    expect(result.current.threads).toHaveLength(0);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('ページ未確定へ戻ったあとに着地した読み込み応答は捨てる', async () => {
    let settle: (value: unknown) => void = () => {};
    hoisted.listCommentThreads.mockImplementationOnce(
      () => new Promise((resolve) => { settle = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string | undefined }) => useKbComments(SLUG, pageId),
      { initialProps: { pageId: PAGE as string | undefined } },
    );
    rerender({ pageId: undefined });

    await act(async () => {
      settle([thread('t1')]);
    });

    expect(result.current.threads).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it('速く別ページへ移ったとき、古い応答で新しい結果を上書きしない', async () => {
    let settleFirst: (value: unknown) => void = () => {};
    hoisted.listCommentThreads.mockImplementationOnce(
      () => new Promise((resolve) => { settleFirst = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ page }: { page: string }) => useKbComments(SLUG, page),
      { initialProps: { page: 'p-old' } },
    );

    hoisted.listCommentThreads.mockResolvedValue([thread('t-new')]);
    rerender({ page: 'p-new' });
    await waitFor(() => expect(result.current.threads).toHaveLength(1));
    expect(result.current.threads[0].id).toBe('t-new');

    // 遅れて着地した旧ページの応答は捨てる。
    await act(async () => {
      settleFirst([thread('t-old')]);
    });
    expect(result.current.threads.map((t) => t.id)).toEqual(['t-new']);
  });

  it('書き込み中に別のページへ切り替わったら、応答が返っても状態に反映しない', async () => {
    let finishResolve: (value: unknown) => void = () => {};
    hoisted.resolveCommentThread.mockImplementationOnce(
      () => new Promise((resolve) => { finishResolve = resolve; }),
    );
    hoisted.listCommentThreads.mockResolvedValue([thread('t1')]);

    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string }) => useKbComments(SLUG, pageId),
      { initialProps: { pageId: PAGE } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const resolving = result.current.resolve('t1');
    await waitFor(() => expect(result.current.saving).toBe(true));

    // 応答が返る前に別のページへ移る。
    hoisted.listCommentThreads.mockResolvedValue([thread('t-other')]);
    rerender({ pageId: 'p-other' });
    await waitFor(() => expect(result.current.threads.map((t) => t.id)).toEqual(['t-other']));

    await act(async () => {
      finishResolve(
        thread('t1', { resolvedAt: '2026-09-02T00:00:00Z', resolvedBy: author('鈴木 花子', 2) }),
      );
      await resolving;
    });

    // 別ページへ移った後の一覧には触れていない。
    expect(result.current.threads.map((t) => t.id)).toEqual(['t-other']);
    expect(result.current.saving).toBe(false);
  });

  it('同じページをいったん離れてすぐ開き直しても、飛んでいる取得を使い回す（同じ一覧を 2 回取らない）', async () => {
    let settleFirst: (value: unknown) => void = () => {};
    hoisted.listCommentThreads.mockImplementationOnce(
      () => new Promise((resolve) => { settleFirst = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string | undefined }) => useKbComments(SLUG, pageId),
      { initialProps: { pageId: PAGE as string | undefined } },
    );

    rerender({ pageId: undefined });
    rerender({ pageId: PAGE });
    await act(async () => {
      settleFirst([thread('t-first')]);
    });

    await waitFor(() => expect(result.current.threads.map((t) => t.id)).toEqual(['t-first']));
    expect(hoisted.listCommentThreads).toHaveBeenCalledTimes(1);
  });

  // 書き込みが飛んでいる間に離れて同じページへ戻っても、作ったスレッドはサーバーにある。
  // 捨てると画面から消えたままになり、そのまま足すと取り直した一覧と二重になりうる。
  // 書いたページの一覧へ、id で重複を見て 1 回だけ足す。
  it('書き込みが飛んでいる間にページを離れてすぐ同じページへ戻っても、作ったスレッドを 1 回だけ出す', async () => {
    let resolveCreate: (t: ReturnType<typeof thread>) => void = () => {};
    hoisted.createCommentThread.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    const { result, rerender } = renderHook(
      ({ pageId }: { pageId: string | undefined }) => useKbComments(SLUG, pageId),
      { initialProps: { pageId: PAGE as string | undefined } },
    );
    await waitFor(() => expect(result.current.loading).toBe(false));

    const createPromise = result.current.createThread([{ type: 'text', text: '新規' }]);

    // 応答が返る前にページを離れて、同じページへすぐ戻る。
    rerender({ pageId: undefined });
    rerender({ pageId: PAGE });
    await waitFor(() => expect(result.current.threads.map((t) => t.id)).toEqual(['t1']));

    await act(async () => {
      resolveCreate(thread('t2'));
      await createPromise;
    });
    await waitFor(() => expect(result.current.threads.map((t) => t.id)).toEqual(['t1', 't2']));
  });

  it('取り直した一覧に作ったスレッドが既に入っていても、二重に増えない', async () => {
    let resolveCreate: (t: ReturnType<typeof thread>) => void = () => {};
    hoisted.createCommentThread.mockImplementation(
      () => new Promise((resolve) => { resolveCreate = resolve; }),
    );
    const { result } = renderHook(() => useKbComments(SLUG, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const createPromise = result.current.createThread([{ type: 'text', text: '新規' }]);
    hoisted.listCommentThreads.mockResolvedValue([thread('t1'), thread('t2')]);
    act(() => result.current.retry());
    await waitFor(() => expect(result.current.threads.map((t) => t.id)).toEqual(['t1', 't2']));

    await act(async () => {
      resolveCreate(thread('t2'));
      await createPromise;
    });

    expect(result.current.threads.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  // CodeRabbit 指摘: 取得が飛んでいる間に書き込みが成功すると、書き込みが state.threads へ
  // 反映される。その後に届く取得結果は書き込み前のスナップショットなので、丸ごと
  // 上書きすると作成済みのスレッドが画面から消える。
  it('最初の読み込み中に作ったら、作った 1 件だけの一覧を作らずに取り直す。古い取得結果でも上書きしない', async () => {
    let resolveFirst: (threads: ReturnType<typeof thread>[]) => void = () => {};
    hoisted.listCommentThreads
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValue([thread('t1'), thread('t2')]);
    const { result } = renderHook(() => useKbComments(SLUG, PAGE));
    await waitFor(() => expect(hoisted.listCommentThreads).toHaveBeenCalledTimes(1));

    await act(async () => {
      await result.current.createThread([{ type: 'text', text: '新規' }]);
    });
    await act(async () => {
      resolveFirst([]);
    });

    await waitFor(() => expect(result.current.threads.map((t) => t.id)).toEqual(['t1', 't2']));
    expect(result.current.loading).toBe(false);
  });
});
