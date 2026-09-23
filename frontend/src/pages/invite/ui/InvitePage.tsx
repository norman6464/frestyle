import { useNavigate } from 'react-router-dom';
import { AuthLayout } from '@/widgets/auth-layout';
import PublicHeader from '@/shared/ui/PublicHeader';
import { Button, FsIcon, Loading } from '@/shared/ui';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { rememberPostLoginPath } from '@/shared/lib/postLoginPath';
import { useInvitePreview } from '../model/useInvitePreview';

const ROLE_DESCRIPTION: Record<string, string> = {
  admin: 'メンバーと権限の管理もできる',
  editor: 'ページを作り、編集できる',
  commenter: '閲覧とコメントができる',
  viewer: '閲覧だけ',
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

/**
 * 招待リンク（/invite#t=…）を開いた画面。**ログイン前に見られる**。
 *
 * ここでは参加できない — トークンは案内を見る鍵で、入る鍵ではない。参加は、宛先の
 * メールアドレスで確認済みのアカウントでログインしてから /invitations で行う。
 * ログイン後にその画面へ戻れるよう、ログインへ送る前に戻り先を置いておく（rememberPostLoginPath）。
 */
export default function InvitePage() {
  useDocumentMeta({ robots: 'noindex, nofollow' });
  const navigate = useNavigate();
  const { state, signedIn } = useInvitePreview();

  const goToLogin = (path: '/login' | '/signup') => {
    rememberPostLoginPath('/invitations');
    navigate(path);
  };

  if (state.status === 'loading') {
    return (
      <AuthLayout header={<PublicHeader />}>
        <Loading className="py-12" message="招待を確認しています" />
      </AuthLayout>
    );
  }

  if (state.status === 'error') {
    return (
      <AuthLayout title="招待を確認できませんでした" description="通信が切れたか、一時的な不調です。少し待ってからもう一度リンクを開いてください。" header={<PublicHeader />}>
        <Button variant="secondary" fullWidth onClick={() => window.location.reload()} className="min-h-12">
          もう一度読み込む
        </Button>
      </AuthLayout>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <AuthLayout title="この招待は使えません" description="期限が切れたか、取り消されたか、すでに使われた招待です。招いた人に新しい招待を頼んでください。" header={<PublicHeader />}>
        <Button variant="secondary" fullWidth onClick={() => navigate(signedIn ? '/' : '/login')} className="min-h-12">
          {signedIn ? 'ホームへ' : 'ログイン画面へ'}
        </Button>
      </AuthLayout>
    );
  }

  const { preview } = state;
  const role = preview.role ?? '';

  return (
    <AuthLayout title="ワークスペースへの招待が届いています" header={<PublicHeader />}>
      <div className="flex flex-col gap-5">
        <p className="text-base leading-relaxed text-[var(--color-text-secondary)]">
          <strong className="text-[var(--color-text-primary)]">{preview.inviterName || 'ワークスペースの管理者'}</strong> さんが、あなた（
          <strong className="text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{preview.email}</strong>）をワークスペース{' '}
          <strong className="text-[var(--color-text-primary)]">{preview.workspaceName}</strong> に{' '}
          <strong className="text-[var(--color-text-primary)]">{role}</strong> として招待しています。
        </p>
        <dl className="grid grid-cols-[6rem_minmax(0,1fr)] gap-x-3 gap-y-1.5 rounded-lg bg-surface-2 p-4 text-sm">
          <dt className="text-[var(--color-text-muted)]">ワークスペース</dt>
          <dd className="font-medium text-[var(--color-text-primary)]">{preview.workspaceName}</dd>
          <dt className="text-[var(--color-text-muted)]">役割</dt>
          <dd className="font-medium text-[var(--color-text-primary)]">
            {role}
            {ROLE_DESCRIPTION[role] ? `（${ROLE_DESCRIPTION[role]}）` : ''}
          </dd>
          {preview.expiresAt && (
            <>
              <dt className="text-[var(--color-text-muted)]">期限</dt>
              <dd className="font-medium text-[var(--color-text-primary)]">{formatDate(preview.expiresAt)} まで</dd>
            </>
          )}
        </dl>
        {signedIn ? (
          <>
            <Button variant="primary" fullWidth onClick={() => navigate('/invitations')} className="min-h-12">
              招待を確認して参加する
              <FsIcon name="arrow-right" className="h-4 w-4" />
            </Button>
            <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
              届いている招待の一覧に移動します。一覧に無いときは、<strong className="text-[var(--color-text-secondary)]">{preview.email}</strong> のアカウントでログインしているか確かめてください。
            </p>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2.5">
              <Button variant="primary" fullWidth onClick={() => goToLogin('/login')} className="min-h-12">
                ログインして参加する
              </Button>
              <Button variant="secondary" fullWidth onClick={() => goToLogin('/signup')} className="min-h-12">
                アカウントを作る
              </Button>
            </div>
            <p className="text-sm leading-relaxed text-[var(--color-text-muted)]">
              参加には <strong className="text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{preview.email}</strong> で確認済みのアカウントが必要です。別のメールアドレスのアカウントでは参加できません。
            </p>
          </>
        )}
      </div>
    </AuthLayout>
  );
}
