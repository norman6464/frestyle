import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { KbAdminWorkspaceMember, KbGrantRole } from '@/entities/kb';
import { ConfirmModal, Loading, PageHeader, fsIcon } from '@/shared/ui';
import EmptyState from '@/shared/ui/EmptyState';
import { getApiError } from '@/shared/lib/classifyApiError';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useKbAdminMembers } from '../model/useKbAdminMembers';
import { useCurrentUserId } from '../model/useCurrentUserId';
import KbMemberRow from './KbMemberRow';

const GENERIC_FAILED = '操作に失敗しました。もう一度お試しください。';

/**
 * mutationErrorMessage は書き込み系の失敗を人が読める文言へ変える。
 *
 * backend の機械可読コード（kb_permission_gate.go の respondKbPermissionOperationErr）に
 * 直接対応させる。汎用の classifyApiError（ステータスコードだけを見る）だと、404 が
 * 「見つからない」としか言えず、この画面固有の「もう居ない相手」という意味を出せない。
 */
function mutationErrorMessage(cause: unknown): string {
  const { status, serverCode } = getApiError(cause);
  if (status === 409 && serverCode === 'last_workspace_admin') {
    return '最後の admin は外せません。先に他の誰かを admin にしてください。';
  }
  if (status === 404) {
    return '対象がこのワークスペースに見当たりません。一覧を更新します。';
  }
  if (status === 400 && serverCode === 'cannot_suspend_self') {
    return '自分自身は操作できません。';
  }
  return GENERIC_FAILED;
}

/** メンバー管理画面（段 7）。役割変更・停止 / 復帰・削除ができる。呼べるのは admin だけ。 */
export default function KbMembersPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { showToast } = useToast();
  const currentUserId = useCurrentUserId();
  const { members, loading, error, busyUserId, retry, changeRole, suspend, restore, remove } =
    useKbAdminMembers(workspaceSlug);
  const [removing, setRemoving] = useState<KbAdminWorkspaceMember | null>(null);

  const runOrToast = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (cause) {
      showToast('error', mutationErrorMessage(cause));
      retry();
    }
  };

  if (error === 'forbidden') {
    return (
      <EmptyState
        headingLevel={1}
        icon={fsIcon('lock')}
        title="この画面は admin だけが開けます"
        description="メンバーの役割変更・停止・削除は、このワークスペースの admin だけが行えます。"
      />
    );
  }

  if (error === 'unknown') {
    return (
      <EmptyState
        headingLevel={1}
        icon={fsIcon('alert-circle')}
        title="メンバー一覧を読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:pt-12">
      <PageHeader title="メンバー管理" description="ワークスペースの役割と参加状態を管理します。役割の変更はすぐに反映されます。" />

      {loading ? <Loading className="min-h-56" message="メンバーを読み込んでいます" /> : members.length === 0 ? (
        <EmptyState icon={fsIcon('users')} title="メンバーがいません" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
          <table role="table" aria-label="ワークスペースのメンバー" className="w-full border-collapse">
            <thead role="rowgroup" className="sr-only md:not-sr-only">
              <tr role="row" className="border-b border-surface-3">
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  メンバー
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  役割
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  状態
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
                  操作
                </th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {members.map((member) => (
                <KbMemberRow
                  key={member.principalId}
                  member={member}
                  isSelf={member.userId === currentUserId}
                  busy={busyUserId === member.userId}
                  onChangeRole={(role: KbGrantRole | null) =>
                    void runOrToast(() => changeRole(member.principalId, member.userId, role))
                  }
                  onSuspend={() => void runOrToast(() => suspend(member.userId))}
                  onRestore={() => void runOrToast(() => restore(member.userId))}
                  onRemove={() => setRemoving(member)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={removing !== null}
        title="メンバーを外しますか？"
        message={
          removing
            ? `${removing.name || 'このメンバー'} をこのワークスペースから外します。権限は失われますが、また招待すれば戻れます。`
            : ''
        }
        confirmText="外す"
        onConfirm={() => {
          if (!removing) return;
          const userId = removing.userId;
          setRemoving(null);
          void runOrToast(() => remove(userId));
        }}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}
