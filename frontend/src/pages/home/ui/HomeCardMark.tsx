/**
 * カードの隅に置く FreStyle の印（ブランドの 3 枚の三角 = 飛翔マーク）。favicon と同じ形で、
 * 奥の 2 枚は淡く、手前の 1 枚だけ差し色。写真やサムネイルの代わりに大きな絵を置くと、枚数の少ない
 * 履歴では同じ絵が並んで壊れた画像のように見えるので、印は小さく（20px）、題名を主役にする。
 * 飾りなので aria-hidden。
 */
export default function HomeCardMark({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`shrink-0 text-brand-600 ${className}`}>
      <path d="M1 11 L10 15 L1 19 Z" fill="currentColor" opacity={0.3} />
      <path d="M6 8 L15 12 L6 16 Z" fill="currentColor" opacity={0.6} />
      <path d="M11 5 L20 9 L11 13 Z" fill="currentColor" />
    </svg>
  );
}
