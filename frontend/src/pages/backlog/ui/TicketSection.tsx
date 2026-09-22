import { useId, useState, type ReactNode } from 'react';
import { FsIcon } from '@/shared/ui';

export interface TicketSectionProps {
  title: string;
  /**
   * 節を畳めるようにする。畳んだ状態から始めたいときは `defaultOpen={false}`。
   * 詳細パネルは縦に長いので、いま見ない節を閉じて全体を短くできる。
   */
  collapsible?: boolean;
  defaultOpen?: boolean;
  /** 見出しの右に添える件数（0 も出す。出したくなければ渡さない）。 */
  count?: number;
  /** 見出しの右端に置く小物（保存状態など）。 */
  action?: ReactNode;
  /**
   * 畳んでいる間も中身を載せたままにする（見えないだけ）。
   *
   * 件数を見出しに出す節で使う。「空なら畳む」を実現するには中身を取りに行く必要があり、
   * 開くまで載せない作りだと件数が永久に分からないため。取りに行く量が小さい節に限る。
   */
  mountWhenClosed?: boolean;
  children: ReactNode;
  headingLevel?: 2 | 3;
}

/**
 * チケットの詳細を構成する節の器。
 *
 * 見出しは `<section aria-label>` にしない。詳細パネルは狭い幅と広い幅の 2 通りが
 * 同時に DOM へ出るので、名前つきの領域が二重になり読み上げの検査に落ちる。
 */
export default function TicketSection({
  title,
  count,
  action,
  collapsible = false,
  defaultOpen = true,
  mountWhenClosed = false,
  children,
  headingLevel = 3,
}: TicketSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = useId();
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  const heading = (
    <span className="text-sm font-bold text-[var(--color-text-primary)]">
      {title}
      {count !== undefined && <span className="ml-1.5 font-normal tabular-nums text-[var(--color-text-muted)]">{count}</span>}
    </span>
  );

  return (
    <div className="mb-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Heading className="min-w-0">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            aria-controls={contentId}
            className="flex min-h-11 items-center gap-2 rounded-md px-1 text-left transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <FsIcon name="chevron-down"
              className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? '' : '-rotate-90'}`}
            />
            {heading}
          </button>
        ) : (
          heading
        )}
        </Heading>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div id={contentId} hidden={!open}>{(open || mountWhenClosed) && children}</div>
    </div>
  );
}
