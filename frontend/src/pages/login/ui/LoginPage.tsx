import { AuthLayout } from '@/widgets/auth-layout';
import PublicHeader from '@/shared/ui/PublicHeader';
import Button from '@/shared/ui/Button';
import InputField from '@/shared/ui/InputField';
import SNSSignInButton from '@/shared/ui/SNSSignInButton';
import LinkText from '@/shared/ui/LinkText';
import { AuthUnavailableNotice } from '@/features/auth';
import { CheckCircleIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline';
import { toChangeHandler } from '@/shared/lib/formHandlers';
import { useLoginPage } from '../model/useLoginPage';

/**
 * ログイン画面。
 *
 * 発行者が 2 通りある——本番（GCIP・Firebase JS SDK）はメールとパスワードをこの画面が
 * その場で受け取ってよい（発行者の SDK が直接検証するので、二要素・ロックアウト・
 * パスワードの強さといった守りはアプリを経由しない）。ローカル開発（Dex）は今までどおり
 * 発行者のログイン画面へ丸ごと送るだけで、パスワードは受け取らない（Dex はその場で
 * 受け取る手段を持たないため）。
 *
 * どちらを出すかは `mode`（ビルド時の設定で決まる）で分岐する。設定が両方とも
 * 欠けているときは、ボタンを消さず理由を添える（`AuthUnavailableNotice`）。
 */
export default function LoginPage() {
  const {
    flashMessage,
    mode,
    email,
    password,
    setEmail,
    setPassword,
    firebaseAuth,
    handleEmailSignIn,
    handleGoogleSignIn,
    dexLogin,
    sessionError,
  } = useLoginPage();

  const firebaseErrorMessage = mode === 'firebase' && firebaseAuth.available ? firebaseAuth.errorMessage : null;
  const dexErrorMessage = mode === 'dex' && dexLogin.available ? dexLogin.errorMessage : null;
  const errorMessage = firebaseErrorMessage ?? dexErrorMessage ?? sessionError;

  const missing =
    mode === 'unconfigured'
      ? [...(!firebaseAuth.available ? firebaseAuth.missing : []), ...(!dexLogin.available ? dexLogin.missing : [])]
      : [];

  return (
    <AuthLayout title="ログイン" description="チームの作業とナレッジの続きへ。" header={<PublicHeader />}>
      {flashMessage && (
        <p
          role="status"
          className="mb-4 flex items-center justify-center gap-1 rounded-lg border border-success-border bg-success-soft p-3 text-center font-medium text-success"
        >
          <CheckCircleIcon className="h-4 w-4" aria-hidden="true" />
          {flashMessage}
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
          <form aria-label="ログインフォーム" onSubmit={handleEmailSignIn}>
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
              autoComplete="current-password"
              value={password}
              onChange={toChangeHandler(setPassword)}
            />
            <div className="-mt-4 mb-6 text-right text-sm">
              <LinkText to="/password-reset">パスワードをお忘れですか？</LinkText>
            </div>
            <Button variant="primary" fullWidth type="submit" loading={firebaseAuth.loading}>
              ログインする
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

          <SNSSignInButton provider="google" disabled={firebaseAuth.loading} onClick={handleGoogleSignIn} />
        </>
      )}

      {mode === 'dex' && dexLogin.available && (
        <>
          <Button
            variant="primary"
            fullWidth
            type="button"
            loading={dexLogin.loading}
            onClick={() => dexLogin.start()}
          >
            {dexLogin.loading ? 'ログイン画面へ移動しています...' : 'ログイン画面へ進む'}
          </Button>

          <div className="relative my-5">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-surface-3"></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="bg-surface-1 px-2 text-[var(--color-text-muted)]">または</span>
            </div>
          </div>

          <SNSSignInButton provider="google" disabled={dexLogin.loading} onClick={() => dexLogin.start('Google')} />
        </>
      )}

      <p className="mt-5 text-center text-sm text-[var(--color-text-muted)]">
        招待された方は招待メールのリンクからログインできます。
        <br />
        アカウントをお持ちでない方は <LinkText to="/signup">アカウントを作成</LinkText>。
      </p>
    </AuthLayout>
  );
}
