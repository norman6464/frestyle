import { useParams, useNavigate } from 'react-router-dom';
import { KbSidebar } from '@/widgets/kb-sidebar';
import { Loading, SidebarSection, fsIcon } from '@/shared/ui';
import { useKbSpaceEntry, KbSpaceTabs, kbRoleLabel } from '@/entities/kb';
import Avatar from '@/shared/ui/Avatar';
import EmptyState from '@/shared/ui/EmptyState';
import { useKbSpaceMembers } from '../model/useKbSpaceMembers';

const VIA_LABEL: Record<string, string> = {
  direct: '直接付与',
  group: 'グループ / スペース全員',
  workspace: 'ワークスペース全体',
};

/**
 * スペースメンバー（段9）。読み取り専用 — 停止・役割変更などの admin 操作は無い
 * （ワークスペース単位の pages/kb-members とは別物。混同しない）。
 */
export default function KbSpaceMembersPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();

  const { workspaceSlug, space, noSpaces, loading, error } = useKbSpaceEntry(spaceId, (id) =>
    navigate(`/kb/spaces/${id}`, { replace: true }),
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* 左の列の「ナレッジの区画」。noSpaces でも常に差し込む（KbSidebar 自身が空の
          ワークスペース／空のスペース一覧を検知して作成フォームを出す）。 */}
      <SidebarSection>
        <KbSidebar workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''} />
      </SidebarSection>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div role="alert" className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {error}
          </div>
        )}

        {!error && noSpaces && (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <h1 className="mb-2 text-lg font-semibold text-[var(--color-text-secondary)]">
                アクセスできるスペースがありません
              </h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                左のサイドバーから、最初のスペースを作れます。
              </p>
            </div>
          </div>
        )}

        {!error && !noSpaces && (loading || !space || !workspaceSlug) && (
          <div role="status" className="flex flex-1 items-center justify-center py-8 text-sm text-[var(--color-text-muted)]">
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

  if (loading) return <Loading className="min-h-56" message="メンバーを読み込んでいます" />;

  if (error) {
    return (
      <EmptyState
        headingLevel={2}
        icon={fsIcon('alert-circle')}
        title="メンバーを読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  if (!loading && members.length === 0) {
    return <EmptyState headingLevel={2} icon={fsIcon('users')} title="このスペースにはまだメンバーがいません" />;
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6">
      <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">スペースのメンバー</h2>
      <p className="mb-5 mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">このスペースにアクセスできる人と、それぞれの役割を確認できます。</p>
      <ul>
        {members.map((member) => (
          <li key={member.userId} className="flex flex-wrap items-center gap-3 border-b border-surface-2 py-4 last:border-b-0">
            <Avatar name={member.name || '?'} src={member.avatarUrl || undefined} size="sm" />
            <div className="min-w-0 flex-1 basis-32">
              <div className="text-sm font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
                {member.name || '（名前未設定）'}
              </div>
              <div className="mt-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
                {VIA_LABEL[member.via] ?? member.via}
              </div>
            </div>
            <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold text-[var(--color-text-tertiary)]">
              {kbRoleLabel(member.role)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
