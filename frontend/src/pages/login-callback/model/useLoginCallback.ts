import { useEffect } from 'react';
import { consumePostLoginPath } from '@/shared/lib/postLoginPath';
import { useAppDispatch } from '@/shared/lib/store';
import { useSearchParams, useNavigate } from 'react-router-dom';

import { setAuthData } from '@/entities/user';
import { AuthRepository as authRepository } from '@/entities/user';
import {
  consumeAuthFlowState,
  exchangeCodeForToken,
  verifyIdTokenNonce,
  saveDexSession,
  readAuthConfig,
} from '@/features/auth';
import { setAuthHint } from '@/shared/lib/authHint';
import { classifyApiError } from '@/shared/lib/classifyApiError';

/** state / nonce の検証に失敗したことを表す（発行者への通信自体は成功している）。 */
class CallbackVerificationError extends Error {}

/**
 * 発行者（ローカル開発の Dex）のログイン画面からの戻りを処理する。
 *
 * 本番（GCIP）はここを通らない——`signInWithPopup` がその場でトークンまで
 * 完結させるため、別タブへ丸ごと遷移するコールバック画面が要らない。
 * ここは Dex（認可コード + PKCE の標準フロー）専用。
 *
 * 認可コードを交換する前に、**戻ってきた state が自分の作った値と一致するか**を確かめる。
 * 確かめないと、攻撃者が自分の認可コードを他人のブラウザに踏ませて、
 * 被害者を攻撃者のアカウントでログインさせられる。
 *
 * 交換して id_token を受け取った後は、**nonce クレームも突き合わせる**。backend は
 * もうこのコード交換に立ち会わない（Bearer の検証だけを行う）ため、id_token を
 * 受け取った側＝ここが自分で確かめる必要がある。
 */
export function useLoginCallback() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const code = searchParams.get('code');
  const returnedState = searchParams.get('state');
  const error = searchParams.get('error');

  useEffect(() => {
    if (error) {
      navigate('/login', { state: { toast: '認証エラーが発生しました' } });
      return;
    }
    if (!code) {
      navigate('/login');
      return;
    }

    // 認可を始めたときに置いた値を取り出す（使い切り。残すと同じ値で 2 回試せる）。
    const flow = consumeAuthFlowState();
    if (!flow) {
      navigate('/login', {
        state: { toast: 'ログインの手続きが見つかりませんでした。もう一度お試しください。' },
      });
      return;
    }
    if (!returnedState || returnedState !== flow.state) {
      navigate('/login', {
        state: { toast: 'ログインの検証に失敗しました。もう一度お試しください。' },
      });
      return;
    }

    const cfg = readAuthConfig();
    if (cfg.status !== 'configured') {
      navigate('/login', {
        state: { toast: '現在ログインを受け付けていません。' },
      });
      return;
    }

    exchangeCodeForToken(cfg, code, flow.codeVerifier)
      .then((token) => {
        if (!verifyIdTokenNonce(token.idToken, flow.nonce)) {
          throw new CallbackVerificationError();
        }
        saveDexSession(token.idToken, token.refreshToken, token.expiresInSeconds);
        return authRepository.login();
      })
      .then(() => {
        dispatch(setAuthData());
        setAuthHint();
        navigate(consumePostLoginPath() ?? '/');
      })
      .catch((err) => {
        const toast =
          err instanceof CallbackVerificationError
            ? 'ログインの検証に失敗しました。もう一度お試しください。'
            : classifyApiError(err, '認証に失敗しました');
        navigate('/login', { state: { toast } });
      });
  }, [code, returnedState, error, dispatch, navigate]);
}
