import { useState, useCallback } from 'react';
import { useAppSelector, useAppDispatch } from '@/shared/lib/store';

import { useNavigate } from 'react-router-dom';
import { classifyApiError } from '@/shared/lib/classifyApiError';
import { clearAuthHint } from '@/shared/lib/authHint';
import { AuthRepository, UserInfo } from '@/entities/user';
import { setAuthData, clearAuth, finishLoading } from '@/entities/user';
import { signOutCurrentProvider } from '@/shared/lib/auth/currentIdToken';

/**
 * 認証フック
 *
 * <p>役割:</p>
 * <ul>
 *   <li>認証状態管理（ログイン、ログアウト、ユーザー情報取得）</li>
 *   <li>AuthRepositoryとRedux storeの統合</li>
 * </ul>
 *
 * <p>Hooks層（Presentation Layer - Business Logic）:</p>
 * <ul>
 *   <li>コンポーネントからビジネスロジックを分離</li>
 *   <li>Repository層を使用してAPI呼び出し</li>
 * </ul>
 */
export const useAuth = () => {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const authState = useAppSelector((state) => state.auth);

  /**
   * ログアウト
   *
   * 発行者側のセッション終了は、いま有効な発行者（GCIP のクライアント SDK /
   * ローカルの Dex）ごとに `signOutCurrentProvider` が吸収する。backend には
   * ログアウト用のエンドポイントが無い（Cookie セッションを持たないため）。
   */
  const logout = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);

    await signOutCurrentProvider().then(
      () => {
        setUser(null);
        dispatch(clearAuth());
        // 認証ヒント（次回の初期描画を早めるための印）も消す。
        // 残すと、ログアウト後の再訪でログイン済みとして描き始めてしまう。
        clearAuthHint();
        navigate('/login');
      },
      (err: unknown) => setError(classifyApiError(err, 'ログアウトに失敗しました。')),
    );
    setLoading(false);
  }, [dispatch, navigate]);

  /**
   * 現在のユーザー情報を取得
   */
  const getCurrentUser = useCallback(async (): Promise<UserInfo | null> => {
    setLoading(true);
    setError(null);

    const userInfo = await AuthRepository.getCurrentUser().then(
      (info) => {
        setUser(info);
        dispatch(setAuthData());
        return info;
      },
      (err: unknown) => {
        setError(classifyApiError(err, 'ユーザー情報の取得に失敗しました。'));
        dispatch(finishLoading());
        return null;
      },
    );
    setLoading(false);
    return userInfo;
  }, [dispatch]);

  return {
    user,
    loading,
    error,
    isAuthenticated: authState.isAuthenticated,
    logout,
    getCurrentUser,
  };
};
