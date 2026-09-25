import { FormEvent, useMemo, useState } from 'react';
import { consumePostLoginPath } from '@/shared/lib/postLoginPath';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAppDispatch } from '@/shared/lib/store';
import { setAuthData } from '@/entities/user';
import { AuthRepository as authRepository } from '@/entities/user';
import {
  useOidcLogin,
  useFirebaseAuth,
  resolveAuthMode,
  type OidcLogin,
  type FirebaseAuthActions,
  type AuthMode,
} from '@/features/auth';
import { setAuthHint } from '@/shared/lib/authHint';
import { readLoginError } from '@/shared/lib/loginRedirect';
import { classifyApiError } from '@/shared/lib/classifyApiError';

export interface LoginPageState {
  /** ログインの戻り処理が失敗して戻ってきたときの理由（失敗として出す）。 */
  readonly loginError: string | null;
  /** どの発行者を出すか。ビルド時の設定で決まる（Firebase を優先。両方揃うことは通常無い）。 */
  readonly mode: AuthMode;
  readonly email: string;
  readonly password: string;
  readonly setEmail: (value: string) => void;
  readonly setPassword: (value: string) => void;
  /** mode === 'firebase' のときだけ使う。 */
  readonly firebaseAuth: FirebaseAuthActions;
  readonly handleEmailSignIn: (e: FormEvent) => void;
  readonly handleGoogleSignIn: () => void;
  /** mode === 'dex' のときだけ使う（発行者のログイン画面へ丸ごと送るボタン）。 */
  readonly dexLogin: OidcLogin;
  /** セッション確立（backend への login()）に失敗したときの案内。 */
  readonly sessionError: string | null;
}

/**
 * LoginPage 用フック。
 *
 * 発行者は 2 通り —本番は GCIP（Firebase JS SDK でメール/パスワードとGoogleをその場で
 * 受け取る）、ローカル開発は Dex（発行者のログイン画面へ丸ごと送る。Dex はメールと
 * パスワードをその場で受け取る手段を持たない）。どちらを出すかは `resolveAuthMode`
 * （ビルド時の設定）で決まり、画面はそれに応じて分岐する。
 *
 * サインインが成立したら、AuthInitializer の購読（`subscribeAuthState`）を待たずに
 * ここで明示的に `authRepository.login()` → `setAuthData()` → 遷移まで行う。
 * `Protected` は Redux の isAuthenticated を同期的に見て未認証なら即 `/login` へ戻すため、
 * 先に遷移してしまうと Redux の更新が追いつかず弾き返される（AuthInitializer 側の
 * 購読は非同期）。AuthInitializer 側の login() 呼び出しは初回読み込み時の状態復元と
 * サインアウト検知のために残り、ここでの呼び出しと重複するが、login() は既存ユーザーに
 * 対しては実質 no-op なので害はない。
 */
export function useLoginPage(): LoginPageState {
  const location = useLocation();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const loginError = readLoginError(location.state);

  const mode = useMemo(() => resolveAuthMode(), []);
  const dexLogin = useOidcLogin();
  const firebaseAuth = useFirebaseAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sessionError, setSessionError] = useState<string | null>(null);

  const establishSessionAndNavigate = async () => {
    try {
      await authRepository.login();
      dispatch(setAuthData());
      setAuthHint();
      navigate(consumePostLoginPath() ?? '/');
    } catch (err) {
      setSessionError(classifyApiError(err, 'ログインに失敗しました。'));
    }
  };

  const handleEmailSignIn = (e: FormEvent) => {
    e.preventDefault();
    if (!firebaseAuth.available) return;
    setSessionError(null);
    firebaseAuth.signInWithEmail(email, password).then((ok) => {
      if (ok) void establishSessionAndNavigate();
    });
  };

  const handleGoogleSignIn = () => {
    if (!firebaseAuth.available) return;
    setSessionError(null);
    firebaseAuth.signInWithGoogle().then((ok) => {
      if (ok) void establishSessionAndNavigate();
    });
  };

  return {
    loginError,
    mode,
    email,
    password,
    // 書き直したら、前の失敗（欄のそばやフォームの上）を消す。直したのに古い失敗が残り続けないように。
    setEmail: (value: string) => {
      setEmail(value);
      if (firebaseAuth.available) firebaseAuth.clearError();
    },
    setPassword: (value: string) => {
      setPassword(value);
      if (firebaseAuth.available) firebaseAuth.clearError();
    },
    firebaseAuth,
    handleEmailSignIn,
    handleGoogleSignIn,
    dexLogin,
    sessionError,
  };
}
