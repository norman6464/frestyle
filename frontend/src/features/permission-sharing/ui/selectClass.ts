/**
 * 共有パネルの選択欄（相手・役割）の見た目。一覧の行と追加の欄で同じ形にそろえる。
 *
 * 狭い画面で 16px を下回ると、iOS は選んだ瞬間に画面を拡大して元に戻さない。狭い画面だけ
 * text-base にする。
 */
export const SHARE_SELECT_CLASS =
  'rounded-md border border-[var(--fs-control-border)] bg-[var(--fs-control-surface)] px-2 text-base text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50 sm:text-sm';
