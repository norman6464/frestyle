import { labelPaint } from '@/shared/lib/labelPaint';
import type { TicketType } from '../model/types';

export interface TicketTypeGlyphProps {
  type: TicketType | undefined;
  className?: string;
}

/**
 * 種別を表す小さな色付きの角丸（見本の Jira が行の先頭に置いているもの）。
 *
 * 種別はプロジェクトごとに利用者が作るので、決め打ちの絵柄は持てない。色はマスタの `color` を
 * そのまま使い、頭の 1 文字を重ねて色だけに頼らないようにする（色覚の差で 2 つの種別が同じに
 * 見えても、文字で読み分けられる）。
 *
 * 文字の色は地の明るさで決める（ラベルと同じ labelPaint）。白で読める地は白、濃い文字で読める
 * 地は濃い文字、どちらでも小さな文字の基準に届かない中くらいの明るさの色は、地に敷かずに
 * 枠と文字にだけ色を使う（白固定だと、たとえば黄色の地で読めない）。
 */
export default function TicketTypeGlyph({ type, className = '' }: TicketTypeGlyphProps) {
  const name = type?.name ?? '';
  const paint = labelPaint(type?.color ?? '');
  const style =
    paint.kind === 'solid'
      ? { backgroundColor: paint.background, color: paint.color }
      : { borderColor: type?.color ?? 'var(--color-surface-3)', color: 'var(--color-text-primary)' };
  return (
    <span
      title={name || undefined}
      aria-label={name ? `種別: ${name}` : undefined}
      role={name ? 'img' : undefined}
      data-paint={paint.kind}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-xs font-bold leading-none ${
        paint.kind === 'outline' ? 'border-2 bg-surface-1' : ''
      } ${className}`}
      style={style}
    >
      {name.slice(0, 1)}
    </span>
  );
}
