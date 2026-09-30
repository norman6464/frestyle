import axios, { AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { getCurrentIdToken } from '@/shared/lib/auth/currentIdToken';

// 空文字なら同一オリジンの相対パスになる。**undefined のままにしない** —
// ローカルではフロントのオリジンにしか届かず backend に繋がらないため。
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/**
 * Axiosインスタンス
 *
 * <p>役割:</p>
 * <ul>
 *   <li>API呼び出しの一元管理</li>
 *   <li>認証トークン（Bearer）の自動付与と、期限切れ時の自動更新</li>
 *   <li>エラーハンドリングの統一</li>
 * </ul>
 *
 * backend は Cookie を発行しない（Bearer の ID トークン検証だけを行う）ため
 * `withCredentials` は使わない。ID トークンは `shared/lib/auth/currentIdToken.ts` が
 * 発行者の違い（GCIP / ローカルの Dex）を吸収して返す。
 */
const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * 公開ページから呼ぶときのリクエスト設定。
 *
 * `skipAuthRedirect: true` を付けた呼び出しは、401（かつ更新失敗）でも
 * /login へ強制遷移しない。「ログイン済みか確かめる」用途では 401 は正常な答えであり、
 * 公開ページの訪問者や検索エンジンのクローラをログイン画面へ追い出してはいけないため
 * （公開 LP の全訪問者が /login に飛ばされた回帰への対応）。
 */
export interface PublicSafeRequestConfig extends AxiosRequestConfig {
  skipAuthRedirect?: boolean;
}

/**
 * リクエストのたびに、いまサインインしている人の ID トークンを Bearer で付ける。
 *
 * トークンが無ければ（未サインイン）何も付けない。未認証で呼べる公開エンドポイント
 * （例: 招待の案内）はこれで通り、認証必須のエンドポイントは backend 側の
 * 401 で弾かれる。
 */
apiClient.interceptors.request.use(async (config) => {
  const token = await getCurrentIdToken();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

/**
 * トークン更新中フラグ
 * 複数のリクエストが同時に401を受けた場合、更新は1回だけ実行
 * （Dex の refresh_token は使い回すと発行者側で失効させられることがあるため、
 * 並行してばらばらに更新を試みると片方が必ず失敗する）。
 */
let isRefreshing = false;

/**
 * 更新待ちのリクエストキュー
 */
let failedQueue: Array<{
  resolve: (value?: unknown) => void;
  reject: (reason?: unknown) => void;
}> = [];

/**
 * キューの処理
 */
const processQueue = (error: AxiosError | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve();
    }
  });

  failedQueue = [];
};

/**
 * レスポンスインターセプター
 * 401エラー時に自動的にトークンを更新（forceRefresh）してから1回だけ再試行する
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      skipAuthRedirect?: boolean;
    };

    // 401エラーかつ、まだリトライしていない場合
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // 既に更新中の場合はキューに追加。再試行の1回分を使い切ったことにしておく
        // （付けないと、再試行がトークンとは無関係の理由でまた401を返したときに
        // 「まだ更新していない401」と誤認して、ここへ二重に更新を始めてしまう）。
        originalRequest._retry = true;
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then(() => {
            return apiClient(originalRequest);
          })
          .catch((err) => {
            return Promise.reject(err);
          });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        // トークン更新。期限的には有効に見えても強制的に更新を試みる
        // （backend とこのブラウザの時計のずれ・失効等、期限だけでは分からない
        // 理由で 401 になっているケースを拾うため）。
        const token = await getCurrentIdToken(true);
        if (!token) {
          throw new Error('id token unavailable after refresh');
        }

        processQueue(null);
        isRefreshing = false;

        // リトライ。Authorization ヘッダは request interceptor が
        // 更新後のトークンで付け直す（ここで手で書き換える必要はない）。
        return apiClient(originalRequest);
      } catch (refreshError) {
        processQueue(error);
        isRefreshing = false;

        // 更新失敗 → ログインページへ。
        // ただし公開ページの認証確認（skipAuthRedirect）では遷移しない。
        if (!originalRequest.skipAuthRedirect && typeof window !== 'undefined') {
          window.location.href = '/login';
        }

        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export default apiClient;
