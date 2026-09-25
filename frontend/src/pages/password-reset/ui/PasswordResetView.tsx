import { AuthNotice, AuthSplitLayout } from '@/widgets/auth-layout';
import { AuthUnavailableNotice } from '@/features/auth';
import { Button, InputField, LinkText } from '@/shared/ui';
import { toChangeHandler } from '@/shared/lib/formHandlers';
import type { PasswordResetPageState } from '../model/usePasswordResetPage';

/**
 * パスワード再設定画面の見た目（ログイン画面と同じ ST06 の形）。状態を受け取って描くだけ。
 *
 * 送った結果（そのアドレスのアカウントがあったか）は画面に出さない（登録の有無を探る手がかりに
 * しないため）。ローカル（Dex）はこの機能を持たないので、その旨を案内する（設定の欠けとは別の状態）。
 */
export default function PasswordResetView(props: PasswordResetPageState) {
  const { mode, email, setEmail, submitted, loading, handleSubmit, missing } = props;

  return (
    <AuthSplitLayout
      eyebrow="Reset password"
      title="パスワードの再設定"
      description={
        mode === 'firebase' && !submitted ? '登録済みのメールアドレスに、パスワード再設定用のリンクをお送りします。' : undefined
      }
      footer={<LinkText to="/login">ログインへ戻る</LinkText>}
    >
      {mode === 'unconfigured' && <AuthUnavailableNotice missing={missing} />}

      {mode === 'dex' && (
        <p
          role="status"
          className="mb-4 rounded-lg border border-warning-border bg-warning-soft p-3 text-sm font-medium text-warning"
        >
          ローカル開発の認証（Dex）はパスワード再設定に対応していません。
        </p>
      )}

      {mode === 'firebase' && !submitted && (
        <form aria-label="パスワード再設定フォーム" onSubmit={handleSubmit} noValidate>
          <InputField
            label="メールアドレス"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={email}
            onChange={toChangeHandler(setEmail)}
          />
          <Button variant="primary" size="lg" fullWidth type="submit" loading={loading}>
            再設定メールを送信
          </Button>
        </form>
      )}

      {mode === 'firebase' && submitted && (
        <AuthNotice tone="success">該当するアカウントが存在する場合、パスワード再設定のご案内をお送りしました。</AuthNotice>
      )}
    </AuthSplitLayout>
  );
}
