import { useId, useRef, useState, type ReactNode } from 'react';
import { ChevronDownIcon } from '@heroicons/react/24/outline';

/** 補助操作を必要なときだけ表示する。メニューではないため通常のTab順を保つ。 */
export default function Disclosure({ label, children, defaultOpen = false, className = '' }: {
  label: string; children: ReactNode; defaultOpen?: boolean; className?: string;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <div className={className} onKeyDown={(event) => {
      if (event.key !== 'Escape' || event.defaultPrevented || !open) return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      trigger.current?.focus();
    }}>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}
        className="ui-control-compact inline-flex items-center gap-2 rounded-md px-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-brand-600">
        <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 shrink-0 ${open ? '' : '-rotate-90'}`} />
        {label}
      </button>
      <div id={id} hidden={!open} className="mt-3">{children}</div>
    </div>
  );
}
