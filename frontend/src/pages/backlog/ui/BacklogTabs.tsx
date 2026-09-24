import { Link } from 'react-router-dom';
import { BACKLOG_TABS, backlogPath, type BacklogView } from '../model/backlogView';

export interface BacklogTabsProps {
  projectId: string;
  current: BacklogView;
}

/**
 * プロジェクトの行の右端に並ぶ面の切替（設計ボード ST08）。下線ではなく文字色で今いる面を示す。
 *
 * 押すと経路が変わる。ほかの場所には置かない —— 同じ行き先が 2 か所にあると、どちらが正か
 * 分からなくなるため。ここは `Link` なので、中クリックで別タブにも開ける。
 */
export default function BacklogTabs({ projectId, current }: BacklogTabsProps) {
  return (
    <nav aria-label="バックログの面" className="flex flex-wrap items-center gap-1">
      {BACKLOG_TABS.map((tab) => {
        const active = tab.view === current;
        return (
          <Link
            key={tab.view}
            to={backlogPath(projectId, tab.view)}
            aria-current={active ? 'page' : undefined}
            // 狭い画面では今いる面を畳む（大きな見出しが同じ名前を出している。設計ボード ST12）。
            className={`min-h-11 items-center rounded-md px-2.5 text-sm transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
              active
                ? 'hidden font-semibold text-brand-700 sm:inline-flex'
                : 'inline-flex text-[var(--color-text-muted)] hover:bg-surface-2 hover:text-[var(--color-text-primary)]'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
