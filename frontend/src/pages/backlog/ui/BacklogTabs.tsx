import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BACKLOG_TABS, backlogPath, type BacklogView } from '../model/backlogView';

export interface BacklogTabsProps {
  projectId: string;
  current: BacklogView;
}

/** タブから移ったことを、移った先へ知らせる印（location.state）。 */
interface BacklogTabState {
  fromBacklogTab?: boolean;
}

/**
 * プロジェクトの行の右端に並ぶ面の切替（設計ボード ST08）。下線ではなく文字色で今いる面を示す。
 *
 * 押すと経路が変わる。ほかの場所には置かない —— 同じ行き先が 2 か所にあると、どちらが正か
 * 分からなくなるため。ここは `Link` なので、中クリックで別タブにも開ける。
 *
 * 一覧の面と設定の面は別の部品なので、行き来すると枠（このタブを含む）ごと作り直され、押した
 * タブからフォーカスが外れて先頭へ戻ってしまう。タブから移ったときは、移った先の今いるタブへ
 * フォーカスを戻す。
 */
export default function BacklogTabs({ projectId, current }: BacklogTabsProps) {
  const location = useLocation();
  const fromTab = (location.state as BacklogTabState | null)?.fromBacklogTab === true;
  const currentRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (fromTab) currentRef.current?.focus();
  }, [fromTab]);

  return (
    <nav aria-label="バックログの面" className="flex flex-wrap items-center gap-1">
      {BACKLOG_TABS.map((tab) => {
        const active = tab.view === current;
        return (
          <Link
            key={tab.view}
            ref={active ? currentRef : undefined}
            to={backlogPath(projectId, tab.view)}
            state={{ fromBacklogTab: true } satisfies BacklogTabState}
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
