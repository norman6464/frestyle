import { ReactNode, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/shared/lib/store';

import { setAuthData, clearAuth, finishLoading } from '@/entities/user';

import { AuthRepository as authRepository } from '@/entities/user';
import { Loading } from '@/shared/ui';
import { setAuthHint, clearAuthHintIfUnauthenticated } from '@/shared/lib/authHint';
import { subscribeAuthState } from '@/features/auth';

interface AuthInitializerProps {
  children: ReactNode;
  /**
   * サインイン状態の購読元。既定は本物の `subscribeAuthState`（GCIP / Dex に接続する）。
   *
   * テスト・Storybook からは差し替える。`subscribeAuthState` は発行者の設定
   * （ビルド時の env）で分岐が決まり、話す相手も実際の Firebase/Dex なので、
   * axios のように `withApi` でアダプタだけ差し替える形（`shared/api/axios.ts` 参照）が
   * 使えない。props 経由の差し替えが最も素直。
   */
  subscribe?: typeof subscribeAuthState;
}

export default function AuthInitializer({ children, subscribe = subscribeAuthState }: AuthInitializerProps) {
  const dispatch = useAppDispatch();
  const loading = useAppSelector((state) => state.auth.loading);

  useEffect(() => {
    // subscribe は発行者の違い（GCIP のクライアント SDK / ローカルの Dex）を吸収する。
    // Firebase はサインイン・サインアウト・トークン自動更新のたびに非同期で呼び直す
    // （購読型）。Dex はマウント時に一度だけ呼ぶ（一発確認）。login()（backend への
    // session 確立）はどちらの場合も安全に繰り返し呼べる（既存ユーザーなら実質 no-op の
    // upsert）ため、呼び出し回数の違いを気にしなくてよい。
    const unsubscribe = subscribe((signedIn) => {
      if (!signedIn) {
        dispatch(clearAuth());
        clearAuthHintIfUnauthenticated({ response: { status: 401 } });
        dispatch(finishLoading());
        return;
      }

      authRepository
        .login()
        .then(() => {
          dispatch(setAuthData());
          setAuthHint();
        })
        .catch((err) => {
          dispatch(clearAuth());
          // 認証切れが確定した(401/403)ときだけ目印を消す。通信断や 5xx で消すと、
          // セッションは生きているのに次回トップの振り分けが効かなくなる。
          clearAuthHintIfUnauthenticated(err);
        })
        .finally(() => {
          dispatch(finishLoading());
        });
    });

    return unsubscribe;
  }, [dispatch, subscribe]);

  if (loading) {
    return <Loading fullscreen />;
  }

  return children;
}
