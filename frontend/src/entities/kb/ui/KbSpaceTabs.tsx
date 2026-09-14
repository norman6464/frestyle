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
    <header className="border-b border-surface-3 px-6 pt-4">
      {/* h2 にしてあるのは、本文側の空表示（EmptyState）が h3 を固定で持つため
          （見出しの段を飛ばさない。h1 は無い — このスペースの画面群に共通する外枠は
          持たず、各画面がここから始まる）。 */}
      <h2 className="mb-2 truncate text-lg font-semibold text-[var(--color-text-primary)]">{space.name}</h2>
      <nav aria-label={`${space.name} の画面切替`} className="flex gap-1">
        {TABS.map((tab) => {
          const to = `/kb/spaces/${space.id}${tab.suffix}`;
          const isActive = tab.id === active;
          return (
            <Link
              key={tab.id}
              to={to}
              aria-current={isActive ? 'page' : undefined}
              className={`rounded-t-md px-3 py-1.5 text-sm font-medium transition-colors ${
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
