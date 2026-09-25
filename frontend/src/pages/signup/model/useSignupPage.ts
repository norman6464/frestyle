import { FormEvent, useMemo, useState } from 'react';
import { consumePostLoginPath } from '@/shared/lib/postLoginPath';
import { useNavigate } from 'react-router-dom';
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
import { classifyApiError } from '@/shared/lib/classifyApiError';
import { useToast } from '@/shared/lib/hooks/useToast';

export interface SignupPageState {
  readonly mode: AuthMode;
  readonly email: string;
  readonly password: string;
  readonly setEmail: (value: string) => void;
  readonly setPassword: (value: string) => void;
  /** mode === 'firebase' のときだけ使う。 */
  readonly firebaseAuth: FirebaseAuthActions;
  readonly handleEmailSignUp: (e: FormEvent) => void;
  readonly handleGoogleSignUp: () => void;
  /** mode === 'dex' のときだけ使う（発行者のログイン画面へ丸ごと送るボタン）。 */
  readonly dexLogin: OidcLogin;
  readonly sessionError: string | null;
}

/**
 * SignupPage 用フック。`pages/login/model/useLoginPage.ts` と対になる。
 *
 * 本番（GCIP）は `createUserWithEmailAndPassword` でこの場でアカウントを作る。
 * ローカル開発（Dex）には自己登録の手段が無い（`docker/idp/config.yaml` は
 * 固定 1 アカウントの `staticPasswords` のみ）ため、Dex モードのボタンは
 * 実質ログイン画面への入り口と同じ（screenHint で登録寄りの見せ方をするだけ）。
 *
 * サインアップ成立後の扱いは useLoginPage と同じ理由で明示的に行う——
 * `authRepository.login()` は初回なら users 行と個人ワークスペースを作る
 * （自己サインアップ）。`Protected` は Redux を同期的に見るため、これを待たずに
 * 遷移すると弾き返される。
 */
export function useSignupPage(): SignupPageState {
  const navigate = useNavigate();
  const dispatch = useAppDispatch();

  const mode = useMemo(() => resolveAuthMode(), []);
  const dexLogin = useOidcLogin();
  const firebaseAuth = useFirebaseAuth();
  const { showToast } = useToast();

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
      setSessionError(classifyApiError(err, 'アカウントの作成に失敗しました。'));
    }
  };

  const handleEmailSignUp = (e: FormEvent) => {
    e.preventDefault();
    if (!firebaseAuth.available) return;
    setSessionError(null);
    firebaseAuth.signUpWithEmail(email, password).then((ok) => {
      if (ok) {
        // メール/パスワード登録は確認メール送信が完了するまでアドレスが「未検証」扱いになる
        // （backend は email_verified を確認できるまでこのアドレスを保存しない）。
        showToast('info', '確認メールを送信しました。届いたメールのリンクからメールアドレスを確認してください。');
        void establishSessionAndNavigate();
      }
    });
  };

  const handleGoogleSignUp = () => {
    if (!firebaseAuth.available) return;
    setSessionError(null);
    firebaseAuth.signInWithGoogle().then((ok) => {
      if (ok) void establishSessionAndNavigate();
    });
  };

  return {
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
    handleEmailSignUp,
    handleGoogleSignUp,
    dexLogin,
    sessionError,
  };
}
