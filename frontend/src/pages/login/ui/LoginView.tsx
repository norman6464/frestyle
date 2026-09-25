import { AuthDivider, AuthNotice, AuthSplitLayout } from '@/widgets/auth-layout';
import { AuthUnavailableNotice } from '@/features/auth';
import { Button, InputField, LinkText, SNSSignInButton } from '@/shared/ui';
import { toChangeHandler } from '@/shared/lib/formHandlers';
import type { LoginPageState } from '../model/useLoginPage';

/**
 * ログイン画面の見た目（設計ボード ST06）。状態を受け取って描くだけで、発行者とはつながない。
 * 本番（GCIP）のフォーム・失敗・設定欠け・ローカル（Dex）の形を、story からそのまま描けるように
 * 分けてある（つなぐのは LoginPage）。
 *
 * - 本番はメールとパスワードをこの場で受け取る。どの欄の直しで解ける失敗かが分かるときは、
 *   その欄のそばに出す（メールかパスワードのどちらかが違う、は欄に寄せない）
 * - ローカル（Dex）は発行者のログイン画面へ送るだけ
 * - ログインの戻り処理が失敗して戻ってきたときは、その理由を失敗として出す
 */
export default function LoginView(props: LoginPageState) {
  const {
    loginError,
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
  } = props;

  const firebase = mode === 'firebase' && firebaseAuth.available ? firebaseAuth : null;
  const dex = mode === 'dex' && dexLogin.available ? dexLogin : null;
  const fieldError = firebase?.errorField ?? null;
  // 欄に寄せられる失敗は欄に、そうでないものはフォームの上に出す（同じ文を 2 か所に出さない）。
  const formError = (fieldError ? null : firebase?.errorMessage) ?? dex?.errorMessage ?? sessionError;

  const missing =
    mode === 'unconfigured'
      ? [...(!firebaseAuth.available ? firebaseAuth.missing : []), ...(!dexLogin.available ? dexLogin.missing : [])]
      : [];

  return (
    <AuthSplitLayout
      eyebrow="Welcome back"
      title="ログイン"
      description="おかえりなさい。続きをはじめましょう。"
      footer={
        <>
          <p>
            アカウントをお持ちでないですか？
            <br />
            <LinkText to="/signup">新規登録</LinkText>
          </p>
          <p className="mt-4">招待を受けた方は、届いた招待リンクを開いてください。</p>
        </>
      }
    >
      {loginError && <AuthNotice tone="error">{loginError}</AuthNotice>}
      {formError && <AuthNotice tone="error">{formError}</AuthNotice>}
      {mode === 'unconfigured' && <AuthUnavailableNotice missing={missing} />}

      {firebase && (
        <>
          <form aria-label="ログインフォーム" onSubmit={handleEmailSignIn} noValidate>
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
              autoComplete="current-password"
              value={password}
              onChange={toChangeHandler(setPassword)}
              error={fieldError === 'password' ? (firebase.errorMessage ?? undefined) : undefined}
            />
            <div className="-mt-3 mb-6">
              <LinkText to="/password-reset">パスワードをお忘れですか？</LinkText>
            </div>
            <Button variant="primary" size="lg" fullWidth type="submit" loading={firebase.loading}>
              ログイン
            </Button>
          </form>
          <AuthDivider />
          <SNSSignInButton provider="google" label="Google でログイン" disabled={firebase.loading} onClick={handleGoogleSignIn} />
        </>
      )}

      {dex && (
        <>
          <Button variant="primary" size="lg" fullWidth type="button" loading={dex.loading} onClick={() => dex.start()}>
            {dex.loading ? 'ログイン画面へ移動しています...' : 'ログイン画面へ進む'}
          </Button>
          <AuthDivider />
          <SNSSignInButton provider="google" label="Google でログイン" disabled={dex.loading} onClick={() => dex.start('Google')} />
        </>
      )}
    </AuthSplitLayout>
  );
}
