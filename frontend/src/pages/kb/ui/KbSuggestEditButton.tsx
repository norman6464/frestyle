export interface KbSuggestEditButtonProps {
  /** ドラフトモード中か。押すたびに呼び出し側（KbPage）がこれを反転させる。 */
  active: boolean;
  onToggle: () => void;
}

/**
 * KbSuggestEditButton は commenter（閲覧+コメントはできるが編集はできない役割）だけに
 * 見える「変更を提案する」の入口。
 *
 * コメント・履歴・テンプレートの各ボタンと同じ場所・同じ見た目のトグルだが、開く先は
 * 浮かぶフォームではなく本文表示エリアそのもの — 押すと本文が編集可能なドラフトモードへ
 * 切り替わる（KbPage 側が draft.open を見て本文の描画を切り替える）。呼び出し側
 * （KbPage）が data.canComment && !data.canEdit のときだけ描画する。
 */
export default function KbSuggestEditButton({ active, onToggle }: KbSuggestEditButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={active}
      className="inline-flex h-8 items-center rounded-md border border-surface-3 px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:h-11"
    >
      変更を提案する
    </button>
  );
}
