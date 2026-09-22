import { Link } from 'react-router-dom';
import { BACKLOG_TABS, backlogPath, type BacklogView } from '../model/backlogView';

export interface BacklogTabsProps {
  projectId: string;
  current: BacklogView;
}

/**
 * プロジェクト見出しの下に並ぶ面の切替（見本と同じ位置・同じ下線の見た目）。
 *
 * 押すと経路が変わる。柱には置かない —— 同じ行き先が 2 か所にあると、どちらが正か
 * 分からなくなるため。ここは `Link` なので、中クリックで別タブにも開ける。
 */
export default function BacklogTabs({ projectId, current }: BacklogTabsProps) {
  return (
    <nav aria-label="バックログの面" className="flex flex-wrap items-center gap-1 px-4">
      {BACKLOG_TABS.map((tab) => {
        const active = tab.view === current;
        return (
          <Link
            key={tab.view}
            to={backlogPath(projectId, tab.view)}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 py-2 text-sm transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
              active
                ? 'border-brand-600 font-semibold text-[var(--color-text-primary)]'
                : 'border-transparent text-[var(--color-text-muted)] hover:border-surface-3 hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
