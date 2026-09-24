import { useId, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KbWorkspaceTabs, useWorkspaceList, type KbAdminWorkspaceMember, type KbGrantRole } from '@/entities/kb';
import { Button, ConfirmModal, Loading, fsIcon } from '@/shared/ui';
import { KbFrame } from '@/widgets/kb-sidebar';
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

/**
 * メンバー管理画面。ワークスペースの名簿を直す（役割変更・停止 / 復帰・削除）。呼べるのは
 * admin だけ。
 *
 * 人を招くのは同じ見出しの「招待」タブ（pages/kb-invitations）。名簿を直すことと招くことは
 * 別の作業なので画面を分けてある。
 *
 * ワークスペースの削除もこの画面の一番下に置く。戻せない操作なので、切替の一覧のように
 * 選ぶ操作の隣には置かず、名簿を扱う管理者が来る場所に離して置く。
 */
export default function KbMembersPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const currentUserId = useCurrentUserId();
  const { workspaces, deleteWorkspace } = useWorkspaceList();
  const dangerHeadingId = useId();
  const [deletingWorkspace, setDeletingWorkspace] = useState(false);
  const [deletePending, setDeletePending] = useState(false);
  const { members, loading, error, busyUserId, retry, changeRole, suspend, restore, remove } =
    useKbAdminMembers(workspaceSlug);
  const [removing, setRemoving] = useState<KbAdminWorkspaceMember | null>(null);
  // 停止と「役割なし」は、相手がすぐに使えなくなる操作なので確認を挟む。
  const [confirming, setConfirming] = useState<{ kind: 'suspend' | 'revokeRole'; member: KbAdminWorkspaceMember } | null>(null);

  const workspace = workspaces.find((w) => w.slug === workspaceSlug);
  const workspaceName = workspace?.name;

  // ナレッジの枠（文脈バーのワークスペース側）の中に出す。スペースを持たない画面なので
  // 左の列（ページの木）は出さない。
  const frame = (content: ReactNode) => (
    <KbFrame workspaceSlug={workspaceSlug} showPagePanel={false}>
      <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>
    </KbFrame>
  );

  const confirmDeleteWorkspace = async () => {
    if (!workspaceSlug) return;
    setDeletePending(true);
    try {
      await deleteWorkspace(workspaceSlug);
    } catch {
      showToast('error', 'ワークスペースを削除できませんでした');
      setDeletePending(false);
      setDeletingWorkspace(false);
      return;
    }
    setDeletePending(false);
    setDeletingWorkspace(false);
    showToast('success', `「${workspaceName ?? 'ワークスペース'}」を削除しました`);
    navigate('/kb');
  };

  const runOrToast = async (action: () => Promise<void>) => {
    try {
      await action();
    } catch (cause) {
      showToast('error', mutationErrorMessage(cause));
      retry();
    }
  };

  if (error === 'forbidden') {
    return frame(
      <EmptyState
        headingLevel={1}
        icon={fsIcon('lock')}
        title="この画面は admin だけが開けます"
        description="メンバーの役割変更・停止・削除は、このワークスペースの admin だけが行えます。"
        action={{ label: 'ナレッジへ戻る', onClick: () => navigate('/kb') }}
      />,
    );
  }

  if (error === 'unknown') {
    return frame(
      <EmptyState
        headingLevel={1}
        icon={fsIcon('alert-circle')}
        title="メンバー一覧を読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />,
    );
  }

  return frame(
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:pt-12">
      <KbWorkspaceTabs workspaceSlug={workspaceSlug ?? ''} workspaceName={workspaceName} active="members" />

      <p className="mb-6 max-w-xl text-sm text-[var(--color-text-muted)]">
        ワークスペースの役割と参加状態を管理します。役割の変更はすぐに反映されます。
      </p>

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
                  onChangeRole={(role: KbGrantRole | null) => {
                    if (role === null) {
                      setConfirming({ kind: 'revokeRole', member });
                      return;
                    }
                    void runOrToast(() => changeRole(member.principalId, member.userId, role));
                  }}
                  onSuspend={() => setConfirming({ kind: 'suspend', member })}
                  onRestore={() => void runOrToast(() => restore(member.userId))}
                  onRemove={() => setRemoving(member)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={confirming !== null}
        title={confirming?.kind === 'suspend' ? 'アカウントを停止しますか？' : '役割を外しますか？'}
        message={
          confirming
            ? confirming.kind === 'suspend'
              ? `${confirming.member.name || 'このメンバー'} はこのワークスペースに入れなくなります。「復帰」でいつでも戻せます。`
              : `${confirming.member.name || 'このメンバー'} のワークスペース全体の役割を外します。個別に共有されたスペースやページ以外は見えなくなります。`
            : ''
        }
        confirmText={confirming?.kind === 'suspend' ? '停止する' : '役割を外す'}
        isDanger
        onConfirm={() => {
          if (!confirming) return;
          const { kind, member } = confirming;
          setConfirming(null);
          void runOrToast(() =>
            kind === 'suspend' ? suspend(member.userId) : changeRole(member.principalId, member.userId, null),
          );
        }}
        onCancel={() => setConfirming(null)}
      />

      <ConfirmModal
        isOpen={removing !== null}
        title="メンバーを外しますか？"
        message={
          removing
            ? `${removing.name || 'このメンバー'} をこのワークスペースから外します。権限は失われますが、また招待すれば戻れます。`
            : ''
        }
        confirmText="外す"
        isDanger
        onConfirm={() => {
          if (!removing) return;
          const userId = removing.userId;
          setRemoving(null);
          void runOrToast(() => remove(userId));
        }}
        onCancel={() => setRemoving(null)}
      />

      {workspace?.canManage && (
        <section
          aria-labelledby={dangerHeadingId}
          className="mt-12 rounded-xl border border-danger/40 p-5"
        >
          <h2 id={dangerHeadingId} className="text-base font-semibold text-[var(--color-text-primary)]">
            ワークスペースの削除
          </h2>
          <p className="mt-1 max-w-xl text-sm leading-relaxed text-[var(--color-text-muted)]">
            中のスペースとページごと削除します。元に戻せません。
          </p>
          <Button variant="danger" onClick={() => setDeletingWorkspace(true)} className="mt-4">
            ワークスペースを削除
          </Button>
        </section>
      )}

      <ConfirmModal
        isOpen={deletingWorkspace}
        title="ワークスペースを削除しますか？"
        message={`「${workspaceName ?? 'このワークスペース'}」を中のスペース・ページごと削除します。元に戻せません。`}
        confirmText="削除する"
        isDanger
        icon="trash"
        pending={deletePending}
        onConfirm={() => void confirmDeleteWorkspace()}
        onCancel={() => setDeletingWorkspace(false)}
      />
    </div>,
  );
}
