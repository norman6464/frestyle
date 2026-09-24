import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { KbWorkspaceTabs, useWorkspaceList, type KbInvitation, type KbIssuedInvitation } from '@/entities/kb';
import { Button, ConfirmModal, FsIcon, fsIcon } from '@/shared/ui';
import EmptyState from '@/shared/ui/EmptyState';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useKbInvitations } from '../model/useKbInvitations';
import { inviteFailure } from '../lib/invitationMessages';
import KbInviteDialog from './KbInviteDialog';
import KbInvitationsSection from './KbInvitationsSection';

/**
 * 招待の画面。ワークスペースへ email で人を招き、承諾待ちの招待を再送・取消する。呼べるのは
 * admin だけ。
 *
 * メンバー管理（役割・停止・削除）とはタブで分けてある。招くことと名簿を直すことは別の作業で、
 * ワークスペース単位の設定（権限など）はこれから増えるため、1 枚に積み上げない。
 */
export default function KbInvitationsPage() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { workspaces } = useWorkspaceList();
  const invitations = useKbInvitations(workspaceSlug);
  // 招待ダイアログ。issuedForDialog は「再送」の結果（新しいリンク）を見せるために開くときの中身。
  const [inviteOpen, setInviteOpen] = useState(false);
  const [issuedForDialog, setIssuedForDialog] = useState<KbIssuedInvitation | null>(null);
  const [revoking, setRevoking] = useState<KbInvitation | null>(null);

  const workspaceName = workspaces.find((w) => w.slug === workspaceSlug)?.name;

  const openInviteDialog = () => {
    setIssuedForDialog(null);
    setInviteOpen(true);
  };

  const resendInvitation = async (invitation: KbInvitation) => {
    try {
      const issued = await invitations.resend(invitation.id);
      setIssuedForDialog(issued);
      setInviteOpen(true);
    } catch (cause) {
      showToast('error', inviteFailure(cause).text);
      invitations.retry();
    }
  };

  const revokeInvitation = async (invitation: KbInvitation) => {
    try {
      await invitations.revoke(invitation.id);
    } catch (cause) {
      showToast('error', inviteFailure(cause).text);
      invitations.retry();
    }
  };

  if (invitations.error === 'forbidden') {
    return (
      <EmptyState
        headingLevel={1}
        icon={fsIcon('lock')}
        title="この画面は admin だけが開けます"
        description="メンバーを招くこと、招待の再送と取り消しは、このワークスペースの admin だけが行えます。"
        action={{ label: 'ナレッジへ戻る', onClick: () => navigate('/kb') }}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:pt-12">
      <KbWorkspaceTabs workspaceSlug={workspaceSlug ?? ''} workspaceName={workspaceName} active="invitations" />

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-xl text-sm text-[var(--color-text-muted)]">
          メールアドレスに招待を送ります。相手が承諾すると、このワークスペースのメンバーになります。
        </p>
        <Button variant="primary" onClick={openInviteDialog} className="min-h-11">
          <FsIcon name="user-plus" className="h-4 w-4" />
          メンバーを招く
        </Button>
      </div>

      <KbInvitationsSection
        invitations={invitations.invitations}
        loading={invitations.loading}
        failed={invitations.error !== null}
        busyId={invitations.busyId}
        onRetry={invitations.retry}
        onResend={(inv) => void resendInvitation(inv)}
        onRevoke={setRevoking}
      />

      <KbInviteDialog
        isOpen={inviteOpen}
        issued={issuedForDialog}
        onInvite={invitations.invite}
        onFailureToast={(text) => {
          showToast('error', text);
          invitations.retry();
        }}
        onClose={() => setInviteOpen(false)}
      />

      <ConfirmModal
        isOpen={revoking !== null}
        title="招待を取り消しますか？"
        message={revoking ? `${revoking.email} 宛の招待を取り消します。送ったリンクは使えなくなります。また招きたいときは新しく作れます。` : ''}
        confirmText="取り消す"
        isDanger
        onConfirm={() => {
          if (!revoking) return;
          const target = revoking;
          setRevoking(null);
          void revokeInvitation(target);
        }}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}
