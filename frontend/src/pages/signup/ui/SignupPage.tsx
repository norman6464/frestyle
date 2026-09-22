import { AuthLayout } from '@/widgets/auth-layout';
import PublicHeader from '@/shared/ui/PublicHeader';
import Button from '@/shared/ui/Button';
import InputField from '@/shared/ui/InputField';
import SNSSignInButton from '@/shared/ui/SNSSignInButton';
import LinkText from '@/shared/ui/LinkText';
import { AuthUnavailableNotice } from '@/features/auth';
import { ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { toChangeHandler } from '@/shared/lib/formHandlers';
import { useSignupPage } from '../model/useSignupPage';

/**
 * アカウント作成画面。`pages/login/ui/LoginPage.tsx` と対になる。
 *
 * 本番（GCIP）はメールとパスワードをこの場で受け取り、その場でアカウントを作る。
 * ローカル開発（Dex）は自己登録の手段を持たない（固定 1 アカウントのみ）ため、
 * 発行者のログイン画面へ送るだけの、従来どおりの入り口を出す。
 */
export default function SignupPage() {
  const {
    mode,
    email,
    password,
    setEmail,
    setPassword,
    firebaseAuth,
    handleEmailSignUp,
    handleGoogleSignUp,
    dexLogin,
    sessionError,
  } = useSignupPage();

  const errorMessage =
    (mode === 'firebase' && firebaseAuth.available ? firebaseAuth.errorMessage : null) ?? sessionError;

  const missing =
    mode === 'unconfigured'
      ? [...(!firebaseAuth.available ? firebaseAuth.missing : []), ...(!dexLogin.available ? dexLogin.missing : [])]
      : [];

  return (
    <AuthLayout title="アカウントを作成" description="作業とナレッジをまとめる場所を始めましょう。" header={<PublicHeader />}>
      {mode !== 'unconfigured' && (
        <p className="mb-6 text-center text-sm text-[var(--color-text-muted)]">
          メールアドレスだけで、すぐに使い始められます。
          <br />
          あなた専用のワークスペースが自動で用意されます。
        </p>
      )}

      {errorMessage && (
        <p
          role="alert"
          className="mb-4 flex items-center justify-center gap-1 rounded-lg border border-danger-border bg-danger-soft p-3 text-center font-medium text-danger-ink"
        >
          <ExclamationCircleIcon className="h-4 w-4" aria-hidden="true" />
          {errorMessage}
        </p>
      )}

      {mode === 'unconfigured' && <AuthUnavailableNotice missing={missing} />}

      {mode === 'firebase' && firebaseAuth.available && (
        <>
          <form aria-label="アカウント作成フォーム" onSubmit={handleEmailSignUp}>
            <InputField
              label="メールアドレス"
              name="email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={toChangeHandler(setEmail)}
            />
            <InputField
              label="パスワード"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={toChangeHandler(setPassword)}
            />
            <Button variant="primary" fullWidth type="submit" loading={firebaseAuth.loading}>
              アカウントを作成
            </Button>
          </form>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-surface-3"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-surface-1 px-2 text-[var(--color-text-muted)]">または</span>
            </div>
          </div>

          <SNSSignInButton provider="google" disabled={firebaseAuth.loading} onClick={handleGoogleSignUp} />
        </>
      )}

      {mode === 'dex' && dexLogin.available && (
        <>
          <Button
            variant="primary"
            fullWidth
            type="button"
            loading={dexLogin.loading}
            onClick={() => dexLogin.start(undefined, 'signup')}
          >
            メールで始める
          </Button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-surface-3"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-surface-1 px-2 text-[var(--color-text-muted)]">または</span>
            </div>
          </div>

          <SNSSignInButton
            provider="google"
            disabled={dexLogin.loading}
            onClick={() => dexLogin.start('Google', 'signup')}
          />
        </>
      )}

      <p className="mt-5 text-center text-sm text-[var(--color-text-muted)]">
        すでにアカウントをお持ちの方は <LinkText to="/login">ログイン</LinkText> へ。
      </p>
    </AuthLayout>
  );
}
