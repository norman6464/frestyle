import type { TicketType } from '../model/types';

export interface TicketTypeGlyphProps {
  type: TicketType | undefined;
  className?: string;
}

/**
 * 種別を表す小さな色付きの角丸（見本の Jira が行の先頭に置いているもの）。
 *
 * 種別はプロジェクトごとに利用者が作るので、決め打ちの絵柄は持てない。色は状態ピルと同じく
 * マスタの `color` をそのまま使い、頭の 1 文字を重ねて色だけに頼らないようにする
 * （色覚の差で 2 つの種別が同じに見えても、文字で読み分けられる）。
 */
export default function TicketTypeGlyph({ type, className = '' }: TicketTypeGlyphProps) {
  const name = type?.name ?? '';
  return (
    <span
      title={name || undefined}
      aria-label={name ? `種別: ${name}` : undefined}
      role={name ? 'img' : undefined}
      className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[9px] font-bold leading-none text-white ${className}`}
      style={{ backgroundColor: type?.color ?? 'var(--color-text-faint)' }}
    >
      {name.slice(0, 1)}
    </span>
  );
}
