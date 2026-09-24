import { useNavigate } from 'react-router-dom';
import { kbRoleLabel, type KbInvitation } from '@/entities/kb';
import { Button, EmptyState, Loading, fsIcon } from '@/shared/ui';
import { getApiError } from '@/shared/lib/classifyApiError';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useMyInvitations } from '../model/useMyInvitations';

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function initials(name: string): string {
  return name.trim().slice(0, 2) || '?';
}

/** 承諾・辞退の失敗を文言にする（backend の respondKbInvitationErr に対応）。 */
function actionErrorMessage(cause: unknown): string {
  const { status } = getApiError(cause);
  if (status === 404) return 'この招待は見当たりません。宛先が違うか、取り消されました。一覧を更新します。';
  if (status === 409) return 'この招待はもう使えません（期限切れか、招いた人が管理者でなくなりました）。一覧を更新します。';
  if (status === 403) return 'メールアドレスの確認が必要です。';
  return '操作に失敗しました。もう一度お試しください。';
}

/**
 * 届いている招待（/invitations）。自分（確認済みの email）宛の未決だけが並ぶ。
 * 通知（type=workspace_invitation）の飛び先であり、招待リンク（/invite）からログインした後の戻り先でもある。
 */
export default function InvitationsPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { invitations, loading, error, busyId, retry, accept, decline } = useMyInvitations();

  const acceptInvitation = async (invitation: KbInvitation) => {
    try {
      const accepted = await accept(invitation.id);
      showToast('success', `${invitation.workspaceName} に参加しました`);
      navigate(`/kb/spaces?workspace=${encodeURIComponent(accepted.workspaceSlug)}`);
    } catch (cause) {
      showToast('error', actionErrorMessage(cause));
      void retry();
    }
  };

  const declineInvitation = async (invitation: KbInvitation) => {
    try {
      await decline(invitation.id);
    } catch (cause) {
      showToast('error', actionErrorMessage(cause));
      void retry();
    }
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-24 pt-8 sm:px-6 lg:pt-12">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)] sm:text-3xl">届いている招待</h1>
        <p className="mt-3 text-base leading-relaxed text-[var(--color-text-muted)]">
          あなたのメールアドレス宛の招待です。参加すると、そのワークスペースへ移動します。
        </p>
      </header>

      {loading && <Loading className="py-16" message="招待を読み込んでいます" />}

      {!loading && error === 'notVerified' && (
        <EmptyState
          headingLevel={2}
          icon={fsIcon('lock')}
          title="メールアドレスの確認が必要です"
          description="招待はメールアドレス宛に届きます。このアカウントには確認済みのメールアドレスがありません。確認を済ませてから、もう一度開いてください。"
          action={{ label: '設定を開く', onClick: () => navigate('/settings') }}
        />
      )}

      {!loading && error === 'unknown' && (
        <EmptyState
          headingLevel={2}
          icon={fsIcon('alert-circle')}
          title="招待を読み込めませんでした"
          description="通信が切れたか、一時的な不調です。"
          action={{ label: '再読み込み', onClick: () => void retry() }}
        />
      )}

      {!loading && error === null && invitations.length === 0 && (
        <EmptyState
          headingLevel={2}
          icon={fsIcon('inbox')}
          title="届いている招待はありません"
          description="招待リンクを受け取ったら、そのリンクを開いてください。ここに並びます。"
        />
      )}

      {!loading && error === null && invitations.length > 0 && (
        <ul aria-label="届いている招待" className="flex flex-col gap-3">
          {invitations.map((inv) => {
            const busy = busyId === inv.id;
            return (
              <li key={inv.id} aria-busy={busy} className="flex flex-col gap-4 rounded-xl border border-surface-3 bg-surface-1 p-5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">
                    {initials(inv.workspaceName)}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-lg font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{inv.workspaceName}</h2>
                    <p className="mt-0.5 text-sm text-[var(--color-text-muted)]">
                      {inv.inviterName ? `${inv.inviterName} さんから · ` : ''}
                      <span className="font-medium text-[var(--color-text-secondary)]">{kbRoleLabel(inv.role)}</span> として · {formatDate(inv.expiresAt)}まで
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 sm:shrink-0">
                  <Button variant="secondary" disabled={busy} onClick={() => void declineInvitation(inv)} className="min-h-11 flex-1 sm:flex-none">
                    辞退する
                  </Button>
                  <Button variant="primary" loading={busy} onClick={() => void acceptInvitation(inv)} className="min-h-11 flex-1 sm:flex-none">
                    参加する
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
