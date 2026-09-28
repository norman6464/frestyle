import { useEffect } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/shared/api/queryClient';
import { AppShell } from '@/widgets/app-shell';

/**
 * ログインしたあとの画面の親。アプリの枠（ヘッダー・下のナビ）と、取得した結果の置き場
 * （TanStack Query のキャッシュ）を配る。
 *
 * 遅延読み込みにしてある（App.tsx）。キャッシュの仕組みと枠は、ログイン前の画面（ログイン・
 * 招待の案内）では要らないので、最初に読む JS（scripts/check-initial-load.mjs の予算）に入れない。
 *
 * ここから外れる（ログアウトして /login へ移る）ときにキャッシュを消す。同じタブで別の人が
 * ログインしたときに、前の人の一覧やプロフィールを一瞬でも出さない。
 */
export default function AuthenticatedLayout() {
  useEffect(() => () => queryClient.clear(), []);
  return (
    <QueryClientProvider client={queryClient}>
      <AppShell />
    </QueryClientProvider>
  );
}
