import { AuthDivider, AuthNotice, AuthSplitLayout } from '@/widgets/auth-layout';
import { AuthUnavailableNotice } from '@/features/auth';
import { Button, InputField, LinkText, SNSSignInButton } from '@/shared/ui';
import { toChangeHandler } from '@/shared/lib/formHandlers';
import type { SignupPageState } from '../model/useSignupPage';

/** パスワードの要件（本番の発行者の最低の長さ）。失敗してから知らせるのではなく、初めから見せる。 */
const PASSWORD_HINT = '6 文字以上で入力してください。';

/**
 * アカウント作成画面の見た目（ログイン画面と同じ ST06 の形）。状態を受け取って描くだけ。
 *
 * - 本番（GCIP）はメールとパスワードでこの場でアカウントを作る。パスワードの要件は欄の下に
 *   初めから出し、欄の直しで解ける失敗（形式・使用済み・短い）はその欄のそばに出す
 * - ローカル（Dex）は自己登録の手段が無いので、発行者の画面へ送る入口だけ
 */
export default function SignupView(props: SignupPageState) {
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
  } = props;

  const firebase = mode === 'firebase' && firebaseAuth.available ? firebaseAuth : null;
  const dex = mode === 'dex' && dexLogin.available ? dexLogin : null;
  const fieldError = firebase?.errorField ?? null;
  const formError = (fieldError ? null : firebase?.errorMessage) ?? dex?.errorMessage ?? sessionError;

  const missing =
    mode === 'unconfigured'
      ? [...(!firebaseAuth.available ? firebaseAuth.missing : []), ...(!dexLogin.available ? dexLogin.missing : [])]
      : [];

  return (
    <AuthSplitLayout
      eyebrow="Get started"
      title="アカウントを作成"
      description={
        mode === 'unconfigured' ? undefined : (
          <>
            {firebase ? 'メールアドレスとパスワードで、すぐに使い始められます。' : 'すぐに使い始められます。'}
            <br />
            あなた専用のワークスペースが自動で用意されます。
          </>
        )
      }
      footer={
        <p>
          すでにアカウントをお持ちですか？
          <br />
          <LinkText to="/login">ログイン</LinkText>
        </p>
      }
    >
      {formError && <AuthNotice tone="error">{formError}</AuthNotice>}
      {mode === 'unconfigured' && <AuthUnavailableNotice missing={missing} />}

      {firebase && (
        <>
          <form aria-label="アカウント作成フォーム" onSubmit={handleEmailSignUp} noValidate>
            <InputField
              label="メールアドレス"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={toChangeHandler(setEmail)}
              error={fieldError === 'email' ? (firebase.errorMessage ?? undefined) : undefined}
            />
            <InputField
              label="パスワード"
              name="password"
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={toChangeHandler(setPassword)}
              hint={PASSWORD_HINT}
              error={fieldError === 'password' ? (firebase.errorMessage ?? undefined) : undefined}
            />
            <Button variant="primary" size="lg" fullWidth type="submit" loading={firebase.loading}>
              アカウントを作成
            </Button>
          </form>
          <AuthDivider />
          <SNSSignInButton provider="google" label="Google で登録" disabled={firebase.loading} onClick={handleGoogleSignUp} />
        </>
      )}

      {dex && (
        <>
          <Button
            variant="primary"
            size="lg"
            fullWidth
            type="button"
            loading={dex.loading}
            onClick={() => dex.start(undefined, 'signup')}
          >
            メールで始める
          </Button>
          <AuthDivider />
          <SNSSignInButton
            provider="google"
            label="Google で登録"
            disabled={dex.loading}
            onClick={() => dex.start('Google', 'signup')}
          />
        </>
      )}
    </AuthSplitLayout>
  );
}
