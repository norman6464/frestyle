import { Link, useLocation } from 'react-router-dom';
import { FsIcon } from '@/shared/ui';
import { KbWorkspaceSwitcher, type KbSpace, type KbWorkspace } from '@/entities/kb';
import KbSpaceSwitcher from './KbSpaceSwitcher';

export interface KbContextBarProps {
  workspaces: KbWorkspace[];
  activeSlug: string | null;
  onSelectWorkspace: (slug: string) => void;
  onCreateWorkspace: (input: { name: string }) => Promise<void>;
  onManageMembers: (slug: string) => void;
  /** 今いるスペース。ワークスペース単位の画面（メンバーと招待）では無い。 */
  space?: KbSpace;
  onCreateSpace: (input: { name: string; visibility?: 'workspace' | 'private' }) => Promise<KbSpace>;
  archivedMode: boolean;
  onToggleArchived: () => void;
  /** 狭い画面で左の列（ページの木）を引き出しとして開く。列の無い画面では渡さない。 */
  onOpenPagePanel?: () => void;
  pagePanelOpen?: boolean;
}

/**
 * KbContextBar はナレッジの文脈バー（設計ボード ST03「FreStyle / 設計スペース ▾」と右端の
 * 概要・メンバー・アーカイブ）。今どのワークスペースのどのスペースにいるかを 1 本の帯で示す。
 *
 * 左はワークスペース単位（切替・メンバーと招待・作成）、その右がスペース単位（切替・作成）。
 * 右端はスペースの中の画面への入口。ページに関する入口（お気に入り・すべてのページ）は
 * 左の列が持ち、同じ入口を 2 か所に並べない。
 *
 * 「アーカイブ」は画面ではなく左の木の表示の切替（押している間は木がアーカイブしたページになる）。
 */
export default function KbContextBar({
  workspaces,
  activeSlug,
  onSelectWorkspace,
  onCreateWorkspace,
  onManageMembers,
  space,
  onCreateSpace,
  archivedMode,
  onToggleArchived,
  onOpenPagePanel,
  pagePanelOpen = false,
}: KbContextBarProps) {
  const { pathname } = useLocation();

  const tabClass = (active: boolean) =>
    `inline-flex min-h-9 items-center rounded-md px-2.5 text-sm transition-colors duration-fast focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11 ${
      active
        ? 'font-semibold text-brand-700'
        : 'text-[var(--color-text-muted)] hover:bg-surface-2 hover:text-[var(--color-text-primary)]'
    }`;

  return (
    <div className="shrink-0 border-b border-surface-3 bg-surface px-2 py-1.5 sm:px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {onOpenPagePanel && (
          <button
            type="button"
            onClick={onOpenPagePanel}
            aria-expanded={pagePanelOpen}
            aria-label="ページの一覧を開く"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-[var(--color-text-tertiary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 md:hidden"
          >
            <FsIcon name="panel" className="h-5 w-5" />
          </button>
        )}

        {/* 今いる場所。ワークスペース / スペースの順に上位から並べる。 */}
        <nav aria-label="いまの場所" className="flex min-w-0 flex-1 items-center gap-0.5">
          <KbWorkspaceSwitcher
            workspaces={workspaces}
            activeSlug={activeSlug}
            onSelect={onSelectWorkspace}
            onCreate={onCreateWorkspace}
            onManageMembers={onManageMembers}
          />
          {space && activeSlug && (
            <>
              <span aria-hidden="true" className="shrink-0 text-[var(--color-text-muted)]">
                /
              </span>
              <KbSpaceSwitcher space={space} workspaceSlug={activeSlug} onCreateSpace={onCreateSpace} />
            </>
          )}
        </nav>

        {space && (
          // 狭い画面では 2 行目に回す。同じ行に詰めると、今いるスペースの名前が押し出されて消える。
          <nav
            aria-label={`${space.name} の画面`}
            className="flex basis-full items-center gap-0.5 sm:basis-auto sm:shrink-0"
          >
            <Link
              to={`/kb/spaces/${space.id}`}
              aria-current={pathname === `/kb/spaces/${space.id}` ? 'page' : undefined}
              className={tabClass(pathname === `/kb/spaces/${space.id}`)}
            >
              概要
            </Link>
            <Link
              to={`/kb/spaces/${space.id}/members`}
              aria-current={pathname === `/kb/spaces/${space.id}/members` ? 'page' : undefined}
              className={tabClass(pathname === `/kb/spaces/${space.id}/members`)}
            >
              メンバー
            </Link>
            <button
              type="button"
              onClick={onToggleArchived}
              aria-pressed={archivedMode}
              // 押している間は左の木がアーカイブしたページになる（画面は移らない）。読み上げ名は
              // 見えている「アーカイブ」を含めて何をするかを足す。木の行の操作メニューの
              // 「アーカイブ」（ページをしまう操作）と同じ名前で並ばないようにするため。
              aria-label="アーカイブしたページを表示"
              title={archivedMode ? '現役のページに戻る' : 'アーカイブしたページを表示'}
              className={tabClass(archivedMode)}
            >
              アーカイブ
            </button>
          </nav>
        )}
      </div>
    </div>
  );
}
