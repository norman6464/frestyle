import { useEffect, useRef, useState } from 'react';
import type { TicketSavedFilter } from '@/entities/ticket';
import { FsIcon, NameCreateForm } from '@/shared/ui';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';
import { savedFilterErrorMessage } from '../lib/savedFilterError';

export interface SavedFilterTabProps {
  filter: TicketSavedFilter;
  pressed: boolean;
  /** 件数の取り直しに失敗した。数字の代わりに「—」を出す。 */
  countFailed: boolean;
  /** タブの見た目（固定のタブと同じ関数を親から受ける）。 */
  tabClass: (active: boolean) => string;
  onSelect: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => void;
}

/**
 * 利用者が保存した絞り込みのタブ 1 つ。固定のタブ（自分の担当・期限切れ・未割り当て）と同じ
 * 並びに置き、右に「…」で名前の変更と削除を持つ。
 *
 * 「…」は常に見せる（ホバーでだけ出すと、タッチの端末では入口が無くなる）。中身は素の
 * ボタン 2 つで ARIA の menu は名乗らない（項目が 2 つで矢印キーの移動を約束するほどではなく、
 * 「名前を変える」は押した後もその場で入力を続ける）。外を押すか Escape で閉じる。
 *
 * 名前の変更はタブをその場で入力欄に置き換える。別の窓を開くより、どの絞り込みの名前を
 * 変えているかが位置で分かる。終わったら（確定でも取り消しでも）タブへフォーカスを戻す。
 */
export default function SavedFilterTab({
  filter,
  pressed,
  countFailed,
  tabClass,
  onSelect,
  onRename,
  onDelete,
}: SavedFilterTabProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const tabRef = useRef<HTMLButtonElement>(null);
  // 入力欄を閉じたあと、次の描画でタブへフォーカスを戻すための印。
  const returnFocus = useRef(false);

  useDismissOnOutside(menuOpen, [containerRef], () => setMenuOpen(false), { returnFocus: triggerRef });

  useEffect(() => {
    if (renaming || !returnFocus.current) return;
    returnFocus.current = false;
    tabRef.current?.focus();
  }, [renaming]);

  const closeRename = () => {
    returnFocus.current = true;
    setRenaming(false);
    setError(null);
  };

  if (renaming) {
    return (
      <span className="flex flex-col gap-1">
        <NameCreateForm
          what="絞り込み"
          layout="inline"
          initialName={filter.name}
          autoFocus
          submitLabel="名前を変える"
          onCancel={closeRename}
          onCreate={async ({ name }) => {
            try {
              await onRename(name);
            } catch (cause) {
              setError(savedFilterErrorMessage(cause, '名前を変えられませんでした。時間をおいてもう一度お試しください。'));
              throw cause;
            }
            closeRename();
          }}
        />
        {error && (
          <p role="alert" className="text-xs text-danger-ink">
            {error}
          </p>
        )}
      </span>
    );
  }

  return (
    <span ref={containerRef} className="relative inline-flex items-center">
      <button ref={tabRef} type="button" aria-pressed={pressed} onClick={onSelect} className={tabClass(pressed)}>
        <span className="max-w-[14rem] truncate">{filter.name}</span>
        {countFailed ? (
          <span aria-label="件数を取得できませんでした" className="text-[var(--color-text-muted)]">
            —
          </span>
        ) : (
          <span className={`tabular-nums ${pressed ? '' : 'text-[var(--color-text-muted)]'}`}>{filter.count}</span>
        )}
      </button>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setMenuOpen((prev) => !prev)}
        aria-expanded={menuOpen}
        aria-label={`${filter.name} の操作`}
        title={`${filter.name} の操作`}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <FsIcon name="more" className="h-4 w-4" />
      </button>
      {menuOpen && (
        <div
          role="group"
          aria-label={`${filter.name} の操作`}
          className="absolute left-0 top-full z-20 mt-1 flex w-44 flex-col gap-0.5 rounded-md border border-surface-3 bg-surface-1 p-1 shadow-lg"
        >
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              setRenaming(true);
            }}
            className="flex min-h-9 items-center rounded-md px-2 text-left text-sm text-[var(--color-text-secondary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
          >
            名前を変える
          </button>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="flex min-h-9 items-center rounded-md px-2 text-left text-sm text-danger-ink hover:bg-danger-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
          >
            削除
          </button>
        </div>
      )}
    </span>
  );
}
