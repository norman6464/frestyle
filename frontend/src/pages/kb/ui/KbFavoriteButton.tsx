import { FsIcon } from '@/shared/ui';

export interface KbFavoriteButtonProps {
  favorite: boolean;
  pending: boolean;
  onToggle: () => void;
}

/**
 * KbFavoriteButton は操作の行の星。押すとお気に入りに入れる／外す（記事面の「いいね」と同じ、枠の無い印）。
 *
 * 状態は `aria-pressed` で伝え、見た目は塗りの星で示す。読み上げ名は「次に何が起きるか」
 * （入れる／外す）にする — 「お気に入り」だけだと押した結果が分からない。
 */
export default function KbFavoriteButton({ favorite, pending, onToggle }: KbFavoriteButtonProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={pending}
      aria-pressed={favorite}
      aria-label={favorite ? 'お気に入りから外す' : 'お気に入りに追加'}
      title={favorite ? 'お気に入りから外す' : 'お気に入りに追加'}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-60 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${
        favorite ? 'text-brand-700' : 'text-[var(--color-text-secondary)]'
      }`}
    >
      <FsIcon name="star" className={`h-4 w-4 ${favorite ? 'fill-current' : ''}`} />
    </button>
  );
}
