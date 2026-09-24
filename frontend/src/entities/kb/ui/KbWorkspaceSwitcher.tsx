import { useEffect, useRef, useState } from 'react';
import { NameCreateForm, FsIcon } from '@/shared/ui';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';
import type { KbWorkspace } from '../model/types';

export interface KbWorkspaceSwitcherProps {
  workspaces: KbWorkspace[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  /** ワークスペースを作る。**失敗は投げてくる**（フォームが入力を保つ）。 */
  onCreate: (input: { name: string }) => Promise<void>;
  /**
   * ワークスペースの「メンバーと招待」を開く。未指定なら入口自体を出さない。
   * 今いるワークスペースを canManage で持つときだけ出す（admin でなければ開いても弾かれるだけ）。
   */
  onManageMembers?: (slug: string) => void;
}

/**
 * KbWorkspaceSwitcher はナレッジの文脈バーの先頭「開発チーム ▾」（設計ボード ST03）。
 *
 * 切替（同時に 1 つ）にしてあるのは、ワークスペースが**会社の境界**だから。
 * 同時に 2 社ぶんを見る場面が無く、並べると「いまどちらを触っているか」が曖昧になる。
 *
 * ワークスペース単位の入口（メンバーと招待・作成）もここに集める。スペース単位の入口
 * （概要・メンバー）は同じ帯の右端にあり、段を分けて同じ見た目で並ばないようにする。
 * 削除は選ぶ操作の隣に置かない（押し間違えると戻せない）。メンバーと招待の画面の下にある。
 */
export default function KbWorkspaceSwitcher({
  workspaces,
  activeSlug,
  onSelect,
  onCreate,
  onManageMembers,
}: KbWorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  // ポップアップ内の「ワークスペースを追加」フォームの開閉。閉じるたびに畳む。
  const [adding, setAdding] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const active = workspaces.find((w) => w.slug === activeSlug) ?? null;

  // 外を押したら・Escape で閉じる（日本語入力の変換キャンセルの Escape では閉じない。
  // 閉じるとポップアップ内の作成フォームごと消え、打ちかけのワークスペース名が失われる）。
  // Escape のときは引き金のボタンへフォーカスを戻す。
  useDismissOnOutside(open, [containerRef], () => setOpen(false), { returnFocus: triggerRef });

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpen((prev) => !prev);
          setAdding(false);
        }}
        aria-expanded={open}
        // 見えている名前を読み上げ名に含め、押すと何が起きるかを足す。
        aria-label={active ? `ワークスペース「${active.name}」を切り替える` : 'ワークスペースを選択'}
        className="inline-flex min-h-9 max-w-[14rem] items-center gap-1 rounded-md px-1.5 text-left hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
      >
        <span className="min-w-0 truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {active?.name ?? 'ワークスペースを選択'}
        </span>
        <FsIcon name="chevron-down" className="h-3.5 w-3.5 shrink-0 text-[var(--color-text-muted)]" />
      </button>

      {open && (
        // ARIA の役割は付けない。**素のボタンの一覧**として出す。
        //
        // listbox は option の中に対話要素を置けず（押下の判定が親に来ない）、menu は矢印キー・
        // Home / End での移動を約束してしまう。どちらも実装しないまま名乗ると、
        // 支援技術には「そう操作できる」と伝わるのに実際には動かない、という嘘になる。
        // 素のボタンなら Tab で辿れて、名乗りと実際が一致する。
        <ul
          aria-label="ワークスペース"
          className="absolute left-0 top-full z-30 mt-1 max-h-80 w-64 max-w-[calc(100vw-2rem)] overflow-y-auto rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg"
        >
          {workspaces.map((workspace) => (
            <li key={workspace.slug}>
              <button
                type="button"
                // 今いるワークスペースの印。'page' ではない（押しても今の画面は変わらない）。
                aria-current={workspace.slug === activeSlug ? 'true' : undefined}
                onClick={() => {
                  onSelect(workspace.slug);
                  setOpen(false);
                }}
                className={`flex min-h-9 w-full min-w-0 items-center gap-2 px-3 text-left text-sm ${
                  workspace.slug === activeSlug
                    ? 'bg-[var(--color-nav-selected)] font-medium text-[var(--color-nav-selected-text)]'
                    : 'text-[var(--color-text-primary)] hover:bg-surface-2'
                }`}
              >
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
              </button>
            </li>
          ))}
          {onManageMembers && active?.canManage && (
            <li className="mt-1 border-t border-surface-3 pt-1">
              <button
                type="button"
                onClick={() => {
                  onManageMembers(active.slug);
                  setOpen(false);
                }}
                className="flex min-h-9 w-full items-center gap-1.5 px-3 text-left text-sm text-[var(--color-text-secondary)] hover:bg-surface-2"
              >
                <FsIcon name="users" className="h-4 w-4 shrink-0" />
                <span>メンバーと招待</span>
              </button>
            </li>
          )}
          <li className="mt-1 border-t border-surface-3 pt-1">
            {/*
              追加の入口はここに置く。見本合わせ — ワークスペース水準の操作は
              上部の切替ポップアップに集める。この入口が無いと、1 つ作った時点で
              新しいワークスペースを作る手段が UI から消える（スペースで踏んだ轍）。
            */}
            {adding ? (
              <NameCreateForm
                what="ワークスペース"
                onCreate={async (input) => {
                  await onCreate(input);
                  // 成功したら閉じる（作った先へは呼び出し側の hook が切り替える）。
                  setAdding(false);
                  setOpen(false);
                }}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                className="flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-sm text-[var(--color-text-muted)] hover:bg-surface-2"
              >
                <FsIcon name="plus" className="h-4 w-4 shrink-0" />
                <span>ワークスペースを追加</span>
              </button>
            )}
          </li>
        </ul>
      )}

    </div>
  );
}
