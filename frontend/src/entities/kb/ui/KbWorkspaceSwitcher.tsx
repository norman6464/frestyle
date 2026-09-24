import { useEffect, useRef, useState } from 'react';
import { ConfirmModal, NameCreateForm, FsIcon } from '@/shared/ui';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';
import type { KbWorkspace } from '../model/types';

export interface KbWorkspaceSwitcherProps {
  workspaces: KbWorkspace[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  /** ワークスペースを作る。**失敗は投げてくる**（フォームが入力を保つ）。 */
  onCreate: (input: { name: string }) => Promise<void>;
  /**
   * ワークスペースを配下ごと消す。**失敗は投げてくる**前提（知らせは呼び出し側）。
   * 未指定なら削除の入口自体を出さない（押せない印を並べない）。
   */
  onDelete?: (slug: string) => Promise<void>;
  /**
   * メンバー管理画面（段 7）を開く。未指定なら入口自体を出さない（onDelete と同じ理由）。
   * canManage を持つワークスペースにだけ出す（admin でなければ開いても弾かれるだけ）。
   */
  onManageMembers?: (slug: string) => void;
}

/**
 * KbWorkspaceSwitcher は最上段のワークスペース切替。
 *
 * 切替（同時に 1 つ）にしてあるのは、ワークスペースが**会社の境界**だから。
 * 同時に 2 社ぶんを見る場面が無く、並べると「いまどちらを触っているか」が曖昧になる。
 * 逆にスペースは同時に見たいので、あちらは見出しとして並べてある。
 */
export default function KbWorkspaceSwitcher({
  workspaces,
  activeSlug,
  onSelect,
  onCreate,
  onDelete,
  onManageMembers,
}: KbWorkspaceSwitcherProps) {
  const [open, setOpen] = useState(false);
  // ポップアップ内の「ワークスペースを追加」フォームの開閉。閉じるたびに畳む。
  const [adding, setAdding] = useState(false);
  // 消す対象。null は「確認していない」。戻せない操作なので必ず一度確かめる。
  const [deleting, setDeleting] = useState<KbWorkspace | null>(null);
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
        className="flex w-full items-center gap-1 rounded-md px-2 py-2 text-left hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-[var(--color-text-primary)]">
          {active?.name ?? 'ワークスペースを選択'}
        </span>
        <FsIcon name="chevron-up-down" className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
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
          className="absolute left-0 right-0 z-20 mt-1 max-h-64 overflow-y-auto rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg"
        >
          {workspaces.map((workspace) => (
            // 触れている間だけ捨てる入口を出す。常に見えていると、選ぶ操作の隣に
            // 戻せない操作が並び続けることになる。
            <li key={workspace.slug} className="group flex items-center">
              <button
                type="button"
                aria-current={workspace.slug === activeSlug}
                onClick={() => {
                  onSelect(workspace.slug);
                  setOpen(false);
                }}
                className="flex min-w-0 flex-1 items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-2"
              >
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                {workspace.slug === activeSlug && (
                  <FsIcon name="check" className="h-4 w-4 shrink-0 text-brand-500" />
                )}
              </button>
              {onManageMembers && workspace.canManage && (
                <button
                  type="button"
                  onClick={() => {
                    onManageMembers(workspace.slug);
                    setOpen(false);
                  }}
                  aria-label={`${workspace.name} のメンバーを管理`}
                  className="ui-hit mr-1 inline-flex shrink-0 items-center justify-center rounded p-1 text-[var(--color-text-tertiary)] opacity-0 transition-opacity hover:bg-surface-3 hover:text-[var(--color-text-primary)] focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <FsIcon name="users" className="h-4 w-4" />
                </button>
              )}
              {onDelete && workspace.canManage && (
                <button
                  type="button"
                  onClick={() => setDeleting(workspace)}
                  aria-label={`${workspace.name} を削除`}
                  className="ui-hit mr-1 inline-flex shrink-0 items-center justify-center rounded p-1 text-[var(--color-text-tertiary)] opacity-0 transition-opacity hover:bg-surface-3 hover:text-danger-ink focus-visible:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100"
                >
                  <FsIcon name="trash" className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
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

      {onDelete && deleting && (
        <ConfirmModal
          isOpen
          title="ワークスペースを削除"
          message={`「${deleting.name}」を中のスペース・ページごと削除します。元に戻せません。`}
          confirmText="削除"
          isDanger
          icon="trash"
          onConfirm={() => {
            const target = deleting;
            setDeleting(null);
            setOpen(false);
            void onDelete(target.slug);
          }}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
