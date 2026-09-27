import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * テスト用のキャッシュ。テストごとに作り直す（前のテストの結果を持ち越さない）。取り直しはしない
 * （失敗の表示をすぐに確かめるため）。
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 30_000, gcTime: Infinity },
      mutations: { retry: false },
    },
  });
}

/** render / renderHook の wrapper に渡す。同じキャッシュを 2 つの部品で共有したいときは client を渡す。 */
export function queryWrapper(client: QueryClient = createTestQueryClient()) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
