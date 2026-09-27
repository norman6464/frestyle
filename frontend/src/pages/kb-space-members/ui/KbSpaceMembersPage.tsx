import { useKbSpaceOutlet } from '@/widgets/kb-sidebar';
import { Loading, fsIcon } from '@/shared/ui';
import { KbSpaceHeading, kbRoleLabel } from '@/entities/kb';
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
  const { workspaceSlug, space } = useKbSpaceOutlet();

  return (
    <>
      <KbSpaceHeading space={space} title="メンバー" />
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <MembersList workspaceSlug={workspaceSlug} spaceId={space.id} />
      </div>
    </>
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
    <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-3 sm:px-6">
      <p className="mb-5 text-sm leading-relaxed text-[var(--color-text-muted)]">このスペースにアクセスできる人と、それぞれの役割を確認できます。</p>
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
