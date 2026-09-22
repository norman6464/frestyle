import { Link } from 'react-router-dom';
import type { KbMySpace } from '../model/types';

export type KbSpaceTab = 'overview' | 'pages' | 'favorites' | 'members';

const TABS: { id: KbSpaceTab; label: string; suffix: string }[] = [
  { id: 'overview', label: '概要', suffix: '' },
  { id: 'pages', label: 'ナレッジ', suffix: '/pages' },
  { id: 'favorites', label: 'お気に入り', suffix: '/favorites' },
  { id: 'members', label: 'メンバー', suffix: '/members' },
];

export interface KbSpaceTabsProps {
  space: KbMySpace;
  active: KbSpaceTab;
}

/**
 * KbSpaceTabs はスペース単位の 4 画面（概要・すべてのページ・お気に入り・メンバー。段14）
 * の見出し。純粋な表示だけを持ち、データの取得は呼び出し側（各 pages/kb-space-*）が行う。
 */
export default function KbSpaceTabs({ space, active }: KbSpaceTabsProps) {
  return (
    <header className="shrink-0 border-b border-surface-3 px-4 pt-5 sm:px-6">
      <p className="mb-2 text-xs font-medium text-[var(--color-text-muted)]">スペース</p>
      <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{space.name}</h1>
      <nav aria-label={`${space.name} の画面切替`} className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
        {TABS.map((tab) => {
          const to = `/kb/spaces/${space.id}${tab.suffix}`;
          const isActive = tab.id === active;
          return (
            <Link
              key={tab.id}
              to={to}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-center rounded-t-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
                isActive
                  ? 'bg-[var(--color-nav-active)] text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-tertiary)] hover:bg-[var(--color-nav-hover)] hover:text-[var(--color-text-primary)]'
              }`}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
