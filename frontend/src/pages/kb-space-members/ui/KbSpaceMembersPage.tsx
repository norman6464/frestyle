import { useParams, useNavigate } from 'react-router-dom';
import { Bars3Icon, ExclamationCircleIcon, UsersIcon } from '@heroicons/react/24/outline';
import { KbSidebar } from '@/widgets/kb-sidebar';
import { SecondaryPanel } from '@/widgets/secondary-panel';
import { useMobilePanelState } from '@/shared/lib/hooks/useMobilePanelState';
import { useKbSpaceEntry, KbSpaceTabs } from '@/entities/kb';
import Avatar from '@/shared/ui/Avatar';
import EmptyState from '@/shared/ui/EmptyState';
import { useKbSpaceMembers } from '../model/useKbSpaceMembers';

const VIA_LABEL: Record<string, string> = {
  direct: '直接付与',
  group: 'グループ / スペース全員',
  workspace: 'ワークスペース全体',
};

const ROLE_LABEL: Record<string, string> = {
  admin: '管理者',
  editor: '編集者',
  commenter: 'コメント可',
  viewer: '閲覧者',
};

/**
 * スペースメンバー（段9）。読み取り専用 — 停止・役割変更などの admin 操作は無い
 * （ワークスペース単位の pages/kb-members とは別物。混同しない）。
 */
export default function KbSpaceMembersPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();
  const { isOpen: mobilePanelOpen, open: openMobilePanel, close: closeMobilePanel } = useMobilePanelState();

  const { workspaceSlug, space, noSpaces, loading, error } = useKbSpaceEntry(spaceId, (id) =>
    navigate(`/kb/spaces/${id}`, { replace: true }),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* サイドバーは noSpaces でも常に描く（KbSidebar 自身が空のワークスペース／空の
          スペース一覧を検知して作成フォームを出す）。 */}
      <SecondaryPanel title="ナレッジ" peekable storageKey="frestyle.panel.note" resizable resizeStorageKey="frestyle.panel.note.width" mobileOpen={mobilePanelOpen} onMobileClose={closeMobilePanel}>
        <KbSidebar workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''} />
      </SecondaryPanel>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center border-b border-surface-3 bg-surface-1 px-4 py-2 md:hidden">
          <button type="button" onClick={openMobilePanel} aria-label="ナレッジを開く" className="p-1">
            <Bars3Icon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {error && (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-text-muted)]">
            {error}
          </div>
        )}

        {!error && noSpaces && (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <p className="mb-1 text-base font-semibold text-[var(--color-text-secondary)]">
                アクセスできるスペースがありません
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                左のサイドバーからワークスペースまたはスペースを作ると使えるようになります。
              </p>
            </div>
          </div>
        )}

        {!error && !noSpaces && (loading || !space || !workspaceSlug) && (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
            読み込み中…
          </div>
        )}

        {!error && !noSpaces && space && workspaceSlug && (
          <>
            <KbSpaceTabs space={space} active="members" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <MembersList workspaceSlug={workspaceSlug} spaceId={space.id} />
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function MembersList({ workspaceSlug, spaceId }: { workspaceSlug: string; spaceId: string }) {
  const { members, loading, error, retry } = useKbSpaceMembers(workspaceSlug, spaceId);

  if (error) {
    return (
      <EmptyState
        icon={ExclamationCircleIcon}
        title="メンバーを読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  if (!loading && members.length === 0) {
    return <EmptyState icon={UsersIcon} title="このスペースにはまだメンバーがいません" />;
  }

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-4">
      <ul>
        {members.map((member) => (
          <li key={member.userId} className="flex items-center gap-2.5 border-b border-surface-2 py-2.5 last:border-b-0">
            <Avatar name={member.name || '?'} src={member.avatarUrl || undefined} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-[var(--color-text-primary)]">
                {member.name || '（名前未設定）'}
              </div>
              <div className="truncate text-xs text-[var(--color-text-muted)]">
                {VIA_LABEL[member.via] ?? member.via}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-[var(--color-text-tertiary)]">
              {ROLE_LABEL[member.role] ?? member.role}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
