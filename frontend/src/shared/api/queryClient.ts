import { QueryClient } from '@tanstack/react-query';
import { getApiError } from '@/shared/lib/classifyApiError';

/**
 * サーバーの状態（取得した一覧・詳細）の置き場。画面をまたいで同じ鍵の結果を共有し、
 * 書き込んだあとは関係する鍵を取り直させる（決まりは shared/README.md の「サーバーの状態」）。
 *
 * - 取り直しは通信が届かなかったとき・5xx のときだけ 2 回まで。4xx（見られない・無い・入力の誤り）は
 *   何度送っても同じなので、すぐに失敗として出す
 * - 30 秒は新しいものとして扱う。画面を行き来するたびに同じ一覧を取り直さない。古くなったものは
 *   次に使うとき・画面に戻ったとき（ウィンドウのフォーカス）に取り直す
 * - 書き込み（mutation）は送り直さない。結果が分からない失敗を二重に送ると、同じ操作が 2 回効く
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < 2 && isRetryable(error),
      },
      mutations: { retry: false },
    },
  });
}

function isRetryable(error: unknown): boolean {
  const { status } = getApiError(error);
  return status === undefined || status >= 500;
}

/** アプリで 1 つだけのキャッシュ。ログイン後の枠（app/layouts/AuthenticatedLayout）が配り、外れたら消す。 */
export const queryClient = createQueryClient();
