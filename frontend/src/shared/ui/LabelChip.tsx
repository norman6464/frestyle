import { labelPaint } from '@/shared/lib/labelPaint';

export interface LabelChipProps {
  name: string;
  color: string;
}

/**
 * ラベル 1 件の見た目。塗り方は色の明るさで決まる（labelPaint）。
 *
 * ビジネスの語彙（チケット・ページ等）を知らない — 名前と色だけを受け取る。
 * チケットのラベル（`pages/backlog/ui/TicketLabelChip`）とナレッジのページラベル
 * （`pages/kb/ui/KbPageMeta`）の両方がここに委譲する。
 */
export default function LabelChip({ name, color }: LabelChipProps) {
  const paint = labelPaint(color);

  if (paint.kind === 'solid') {
    return (
      <span
        className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-semibold leading-relaxed"
        style={{ backgroundColor: paint.background, color: paint.color }}
      >
        {name}
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1 rounded border bg-surface-1 px-1.5 py-0.5 text-xs font-semibold leading-relaxed text-[var(--color-text-primary)]"
      style={{ borderColor: paint.borderColor }}
    >
      <span
        aria-hidden="true"
        className="h-2 w-2 flex-none rounded-full"
        style={{ backgroundColor: paint.borderColor }}
      />
      {name}
    </span>
  );
}
