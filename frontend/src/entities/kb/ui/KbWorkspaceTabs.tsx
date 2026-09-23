import { Link } from 'react-router-dom';

export type KbWorkspaceTab = 'members' | 'invitations';

const TABS: { id: KbWorkspaceTab; label: string; suffix: string }[] = [
  { id: 'members', label: 'メンバー', suffix: '/members' },
  { id: 'invitations', label: '招待', suffix: '/invitations' },
];

export interface KbWorkspaceTabsProps {
  workspaceSlug: string;
  /**
   * ワークスペース名。取得できていなければ省く。見出しは名前に依らず「メンバーと招待」で
   * 一定にし、名前はその上の小さい行に出す（読み込みの一瞬だけ見出しが空になるのを避ける）。
   */
  workspaceName?: string;
  active: KbWorkspaceTab;
}

/**
 * KbWorkspaceTabs はワークスペース単位の管理画面（メンバー・招待）の見出し。
 *
 * KbSpaceTabs（スペース単位の 4 画面）と同じ形をとるが、あちらはスペースの名簿・ページで、
 * こちらはワークスペースの名簿と招待。別の階層なので別の部品として持つ。権限の設定など
 * ワークスペース単位の画面が増えたら、ここへタブを足す。
 *
 * 表示だけを持ち、データの取得は呼び出し側（各 pages/kb-*）が行う。
 */
export default function KbWorkspaceTabs({ workspaceSlug, workspaceName, active }: KbWorkspaceTabsProps) {
  return (
    <header className="mb-6 border-b border-surface-3">
      <p className="text-xs font-medium text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
        ワークスペース{workspaceName ? ` · ${workspaceName}` : ''}
      </p>
      <h1 className="mb-4 mt-1 text-2xl font-bold text-[var(--color-text-primary)]">メンバーと招待</h1>
      <nav aria-label="メンバーと招待の画面切替" className="grid grid-cols-2 gap-1 sm:flex sm:flex-wrap">
        {TABS.map((tab) => {
          const isActive = tab.id === active;
          return (
            <Link
              key={tab.id}
              to={`/kb/${encodeURIComponent(workspaceSlug)}${tab.suffix}`}
              aria-current={isActive ? 'page' : undefined}
              className={`flex min-h-11 items-center justify-center rounded-t-md px-4 py-2 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
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
