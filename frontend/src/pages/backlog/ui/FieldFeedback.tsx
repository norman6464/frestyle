import { FsIcon, type FsIconName } from '@/shared/ui';
import type { WriteOutcome } from '../lib/writeOutcome';

export interface FieldFeedbackProps {
  outcome: WriteOutcome | null;
  /** 結果が分からないとき（unknown）に出す「最新を確認」。渡さなければ出さない。 */
  onVerify?: () => void;
  className?: string;
}

const VIEW: Record<WriteOutcome['kind'], { icon: FsIconName; className: string }> = {
  saving: { icon: 'clock', className: 'text-[var(--color-text-muted)]' },
  saved: { icon: 'check', className: 'text-success' },
  rejected: { icon: 'alert-circle', className: 'text-danger-ink' },
  unknown: { icon: 'alert-triangle', className: 'text-[var(--color-text-secondary)]' },
};

/**
 * 操作した場所のすぐ下に出す、変更の結果の 1 行（設計ボード PX04）。
 *
 * 色だけに意味を預けない（形の違う印と文言を必ず添える）。動きも使わない —— 送っている間の印は
 * 回さず、止まった時計と文言で示す（動きを減らす設定でも同じに読める）。
 *
 * 読み上げの領域は結果が無いときも置いておき、変わったときにだけ文字を入れる（後から現れた
 * 領域は読み上げが拾わない）。失敗は次の操作まで消さない。
 */
export default function FieldFeedback({ outcome, onVerify, className = '' }: FieldFeedbackProps) {
  const view = outcome ? VIEW[outcome.kind] : null;
  return (
    <p role="status" aria-live="polite" className={outcome ? `flex flex-wrap items-center gap-x-2 gap-y-1 text-xs ${className}` : 'sr-only'}>
      {outcome && view && (
        <>
          <span className={`inline-flex items-center gap-1 ${view.className}`}>
            <FsIcon name={view.icon} className="h-3.5 w-3.5 shrink-0" />
            {outcome.message}
          </span>
          {outcome.kind === 'unknown' && onVerify && (
            <button
              type="button"
              onClick={onVerify}
              className="inline-flex min-h-9 items-center gap-1 rounded-md border border-surface-3 px-2 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
            >
              <FsIcon name="refresh" className="h-3.5 w-3.5" />
              最新を確認
            </button>
          )}
        </>
      )}
    </p>
  );
}
