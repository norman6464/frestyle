import { act, renderHook as rtlRenderHook, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryWrapper } from '@/test/queryClient';
import { useKbShare } from '../useKbShare';

const renderHook: typeof rtlRenderHook = ((callback: Parameters<typeof rtlRenderHook>[0], options?: Parameters<typeof rtlRenderHook>[1]) =>
  rtlRenderHook(callback, { wrapper: queryWrapper(), ...options })) as typeof rtlRenderHook;

const hoisted = vi.hoisted(() => ({
  listPageGrants: vi.fn(),
  listGrantablePrincipals: vi.fn(),
  grantPageRole: vi.fn(),
  revokePageRole: vi.fn(),
}));

// 取得の本体を偽物にする（公開口の KbRepository だけを替えると、共有の問い合わせは本物を呼ぶ）。
vi.mock('@/entities/kb/api/kbRepository', () => ({
  default: {
    listPageGrants: hoisted.listPageGrants,
    listGrantablePrincipals: hoisted.listGrantablePrincipals,
    grantPageRole: hoisted.grantPageRole,
    revokePageRole: hoisted.revokePageRole,
  },
}));

const SLUG = 'w-3f2a9c';
const PAGE = 'p1';

const grant = (principalId: string, role = 'editor') => ({
  pageId: PAGE,
  principalId,
  role,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

beforeEach(() => {
  vi.clearAllMocks();
  hoisted.listPageGrants.mockResolvedValue([grant('pr-tanaka')]);
  hoisted.listGrantablePrincipals.mockResolvedValue([
    { id: 'pr-tanaka', kind: 'user', name: '田中 太郎' },
    { id: 'pr-dev', kind: 'group', name: '開発チーム' },
  ]);
  hoisted.grantPageRole.mockResolvedValue(grant('pr-dev'));
  hoisted.revokePageRole.mockResolvedValue(undefined);
});

describe('useKbShare', () => {
  it('ページが決まっていなければ何も取りに行かない', () => {
    renderHook(() => useKbShare(undefined, undefined));

    expect(hoisted.listPageGrants).not.toHaveBeenCalled();
    expect(hoisted.listGrantablePrincipals).not.toHaveBeenCalled();
  });

  it('主体 ID で突き合わせて表示名を付ける', async () => {
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([
      { principalId: 'pr-tanaka', role: 'editor', name: '田中 太郎', kind: 'user' },
    ]);
  });

  it('相手の一覧に居ない主体でも行を落とさない', async () => {
    // 引いた直後に主体が消えるとこうなる。ここで行を消すと、取り消せない権限が
    // 画面から見えないまま残る（誰が見られるのかを人が説明できなくなる）。
    hoisted.listPageGrants.mockResolvedValue([grant('pr-gone')]);
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.rows).toEqual([
      { principalId: 'pr-gone', role: 'editor', name: '', kind: 'unknown' },
    ]);
  });

  it('すでに権限を持っている相手は追加の候補から外す', async () => {
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.candidates.map((candidate) => candidate.id)).toEqual(['pr-dev']);
  });

  it('付与のあとは引き直す（画面と実態をずらさない）', async () => {
    // 弱い役割を張っても上位の役割で上書きされない、といった規則がサーバーにあるので、
    // 楽観的に画面だけ書き換えるとずれたまま残る。
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(hoisted.listPageGrants).toHaveBeenCalledTimes(1);

    hoisted.listPageGrants.mockResolvedValue([grant('pr-tanaka'), grant('pr-dev', 'viewer')]);
    await act(async () => {
      await result.current.grant('pr-dev', 'viewer');
    });

    expect(hoisted.grantPageRole).toHaveBeenCalledWith(SLUG, PAGE, 'pr-dev', 'viewer');
    expect(hoisted.listPageGrants).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(result.current.rows).toHaveLength(2));
  });

  it('取り消しのあとも引き直す', async () => {
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.listPageGrants.mockResolvedValue([]);
    await act(async () => {
      await result.current.revoke('pr-tanaka');
    });

    expect(hoisted.revokePageRole).toHaveBeenCalledWith(SLUG, PAGE, 'pr-tanaka');
    await waitFor(() => expect(result.current.rows).toHaveLength(0));
  });

  it('読み込みに失敗したら理由を出し、古い行を残さない', async () => {
    hoisted.listPageGrants.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/権限を読めませんでした/);
    expect(result.current.rows).toHaveLength(0);
  });

  it('書き込みに失敗したら理由を出し、行はそのまま残す', async () => {
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    hoisted.grantPageRole.mockRejectedValue(new Error('boom'));
    await act(async () => {
      await result.current.grant('pr-dev', 'viewer');
    });

    expect(result.current.error).toMatch(/権限を変えられませんでした/);
    expect(result.current.saving).toBe(false);
    // 失敗した書き込みで画面を空にしない（何が張られているかは変わっていない）。
    expect(result.current.rows).toHaveLength(1);
  });

  it('速く開き直したとき、古い応答で新しい結果を上書きしない', async () => {
    // 1 本目をわざと遅らせ、2 本目のページの結果が出たあとに着地させる。
    let settleFirst: (value: unknown) => void = () => {};
    hoisted.listPageGrants.mockImplementationOnce(
      () => new Promise((resolve) => { settleFirst = resolve; }),
    );

    const { result, rerender } = renderHook(({ page }) => useKbShare(SLUG, page), {
      initialProps: { page: 'p-old' },
    });

    hoisted.listPageGrants.mockResolvedValue([grant('pr-dev')]);
    rerender({ page: 'p-new' });
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    expect(result.current.rows[0].principalId).toBe('pr-dev');

    // 遅れて着地した古い応答は捨てる。
    await act(async () => {
      settleFirst([grant('pr-tanaka'), grant('pr-dev')]);
    });
    expect(result.current.rows.map((row) => row.principalId)).toEqual(['pr-dev']);
  });
});

describe('useKbShare の宛先', () => {
  it('書き込み中にページを移ったら、旧ページを引き直さない', async () => {
    // 引き直しが旧ページへ向かうと、新しいページのパネルに旧ページの相手が並び、
    // そのまま権限を張れてしまう（宛先が画面と食い違う）。
    let finishWrite: () => void = () => {};
    hoisted.grantPageRole.mockImplementationOnce(
      () => new Promise<void>((resolve) => { finishWrite = resolve; }),
    );

    const { result, rerender } = renderHook(({ page }) => useKbShare(SLUG, page), {
      initialProps: { page: 'p-old' },
    });
    await waitFor(() => expect(result.current.loading).toBe(false));

    const writing = result.current.grant('pr-dev', 'viewer');
    hoisted.listPageGrants.mockClear();

    // 書き込みが飛んでいる間に別のページへ移る。
    rerender({ page: 'p-new' });
    await waitFor(() => expect(hoisted.listPageGrants).toHaveBeenCalledWith(SLUG, 'p-new'));
    hoisted.listPageGrants.mockClear();

    let succeeded: boolean | undefined;
    await act(async () => {
      finishWrite();
      succeeded = await writing;
    });

    expect(succeeded).toBe(false);
    expect(hoisted.listPageGrants).not.toHaveBeenCalled();
  });

  it('宛先が無くなったら状態を畳む（次に開いたとき前のページの行を出さない）', async () => {
    const { result, rerender } = renderHook(
      ({ page }: { page: string | undefined }) => useKbShare(SLUG, page),
      { initialProps: { page: 'p1' as string | undefined } },
    );
    await waitFor(() => expect(result.current.rows).toHaveLength(1));

    rerender({ page: undefined });

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.candidates).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('閉じたあとに着地した応答は捨てる', async () => {
    let settle: (value: unknown) => void = () => {};
    hoisted.listPageGrants.mockImplementationOnce(
      () => new Promise((resolve) => { settle = resolve; }),
    );

    const { result, rerender } = renderHook(
      ({ page }: { page: string | undefined }) => useKbShare(SLUG, page),
      { initialProps: { page: 'p1' as string | undefined } },
    );
    rerender({ page: undefined });

    await act(async () => {
      settle([grant('pr-tanaka')]);
    });

    expect(result.current.rows).toHaveLength(0);
    expect(result.current.loading).toBe(false);
  });

  it('成功・失敗を呼び出し側へ返す', async () => {
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));
    await waitFor(() => expect(result.current.loading).toBe(false));

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.grant('pr-dev', 'viewer');
    });
    expect(ok).toBe(true);

    hoisted.grantPageRole.mockRejectedValue(new Error('boom'));
    await act(async () => {
      ok = await result.current.grant('pr-dev', 'viewer');
    });
    expect(ok).toBe(false);
  });
});

describe('useKbShare の要求の連番', () => {
  it('一覧を持っているうちの取り直しの途中で、古い取得があとから着地しても捨てる', async () => {
    // 宛先だけを見ていると、同じページへの 2 本目が飛んでいる最中に 1 本目が着地して
    // 古い一覧で上書きされる（宛先が同じなので見分けられない）。
    const { result } = renderHook(() => useKbShare(SLUG, PAGE));
    await waitFor(() => expect(result.current.rows).toHaveLength(1));
    let settleStale: (value: unknown) => void = () => {};
    hoisted.listPageGrants.mockImplementationOnce(
      () => new Promise((resolve) => { settleStale = resolve; }),
    );
    act(() => {
      void result.current.reload();
    });
    await waitFor(() => expect(hoisted.listPageGrants).toHaveBeenCalledTimes(2));

    // 1 本目が飛んでいる間に取り直しを起こす（付与の成功が同じことをする）。
    hoisted.listPageGrants.mockResolvedValue([grant('pr-dev')]);
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.rows.map((row) => row.principalId)).toEqual(['pr-dev']));

    // 遅れて着地した 1 本目は捨てる。
    await act(async () => {
      settleStale([grant('pr-tanaka'), grant('pr-dev')]);
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(result.current.rows.map((row) => row.principalId)).toEqual(['pr-dev']);
  });
});
