import { useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

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
}: TicketSectionProps) {
  const [open, setOpen] = useState(defaultOpen);

  const heading = (
    <span className="text-sm font-bold text-[var(--color-text-primary)]">
      {title}
      {count !== undefined && <span className="ml-1.5 font-normal tabular-nums text-[var(--color-text-muted)]">{count}</span>}
    </span>
  );

  return (
    <div className="mb-5">
      <div className="mb-2 flex items-center gap-1.5">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((prev) => !prev)}
            aria-expanded={open}
            className="flex items-center gap-1.5 rounded-md text-left transition-colors hover:text-[var(--color-text-primary)]"
          >
            <ChevronDownIcon
              aria-hidden="true"
              className={`h-4 w-4 shrink-0 text-[var(--color-text-muted)] transition-transform ${open ? '' : '-rotate-90'}`}
            />
            {heading}
          </button>
        ) : (
          heading
        )}
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {open ? children : mountWhenClosed && <div hidden>{children}</div>}
    </div>
  );
}
