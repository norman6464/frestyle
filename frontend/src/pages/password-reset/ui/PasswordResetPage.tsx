import { AuthLayout } from '@/widgets/auth-layout';
import PublicHeader from '@/shared/ui/PublicHeader';
import Button from '@/shared/ui/Button';
import InputField from '@/shared/ui/InputField';
import LinkText from '@/shared/ui/LinkText';
import { AuthUnavailableNotice } from '@/features/auth';
import { toChangeHandler } from '@/shared/lib/formHandlers';
import { usePasswordResetPage } from '../model/usePasswordResetPage';
import { FsIcon } from '@/shared/ui';

/**
 * パスワード再設定画面。GCIP（Firebase）だけの機能。
 *
 * ローカル開発（Dex）はこの機能を持たない（固定 1 アカウントのみ）ため、画面自体を
 * 隠さず、その旨を案内する——`AuthUnavailableNotice`（設定そのものが欠けている状態）
 * とは別の状態として扱う。
 */
export default function PasswordResetPage() {
  const { mode, email, setEmail, submitted, loading, handleSubmit, missing } = usePasswordResetPage();

  return (
    <AuthLayout title="パスワードの再設定" header={<PublicHeader />}>
      {mode === 'unconfigured' && <AuthUnavailableNotice missing={missing} />}

      {mode === 'dex' && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-warning-border bg-warning-soft p-3 text-center text-sm font-medium text-warning"
        >
          ローカル開発の認証（Dex）はパスワード再設定に対応していません。
        </p>
      )}

      {mode === 'firebase' && !submitted && (
        <>
          <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
            登録済みのメールアドレスに、パスワード再設定用のリンクをお送りします。
          </p>
          <form aria-label="パスワード再設定フォーム" onSubmit={handleSubmit}>
            <InputField
              label="メールアドレス"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={toChangeHandler(setEmail)}
            />
            <Button variant="primary" fullWidth type="submit" loading={loading}>
              再設定メールを送信
            </Button>
          </form>
        </>
      )}

      {mode === 'firebase' && submitted && (
        <p
          role="status"
          className="mb-4 flex items-center justify-center gap-1 rounded-lg border border-success-border bg-success-soft p-3 text-center font-medium text-success"
        >
          <FsIcon name="check-circle" className="h-4 w-4" />
          該当するアカウントが存在する場合、パスワード再設定のご案内をお送りしました。
        </p>
      )}

      <p className="mt-5 text-center text-sm text-[var(--color-text-muted)]">
        <LinkText to="/login">ログインへ戻る</LinkText>
      </p>
    </AuthLayout>
  );
}
