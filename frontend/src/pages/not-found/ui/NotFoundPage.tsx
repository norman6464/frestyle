import { Link } from 'react-router-dom';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { hasAuthHint } from '@/shared/lib/authHint';
import { PublicHeader } from '@/shared/ui';

/**
 * 存在しない URL の受け皿。
 *
 * catch-all（`path="*"`）が無かったため、タイポ・古いリンク・削除済みリソースで
 * 完全に真っ白な画面になり、戻る手段が無いまま離脱していた。
 *
 * ログイン状態は目印 Cookie で判断する。認証必須ルートの外に置く
 * ページなので `/auth/me` の結果を待つと表示が遅れ、待たずに Redux を読むと未確定の
 * 既定値（未ログイン扱い）で描画してしまう。この画面は行き先の案内を出し分けるだけで
 * 権限を判定しないため、目印で十分（実際の認証は遷移先で行われる）。
 */
export default function NotFoundPage() {
  // 存在しない URL が検索結果に載らないようにする。SPA は HTTP 404 を返せないため、
  // 少なくとも検索エンジンには「登録しないでほしい」と伝える。
  useDocumentMeta({
    title: 'ページが見つかりません | FreStyle',
    robots: 'noindex, nofollow',
  });

  const signedIn = hasAuthHint();

  return (
    <div className="h-full overflow-y-auto bg-surface">
      <div className="flex min-h-full flex-col">
        <PublicHeader />

        <main className="flex flex-1 items-center justify-center px-4 py-16">
          <div className="w-full max-w-md text-center">
            <p className="font-mono text-sm font-semibold tracking-widest text-brand-700">404</p>
            <h1 className="mt-2 text-2xl font-bold text-[var(--color-text-primary)]">ページが見つかりません</h1>
            <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
              お探しのページは移動または削除された可能性があります。
              <br />
              URL に誤りがないかご確認ください。
            </p>

            {/* 行き先が同じボタンを 2 つ並べない。ログイン済みはホーム、未ログインはログイン画面へ。 */}
            <div className="mt-8 flex justify-center">
              <Link
                to={signedIn ? '/' : '/login'}
                className="inline-flex min-h-11 items-center justify-center rounded-lg bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
              >
                {signedIn ? 'ホームへ戻る' : 'ログイン画面へ'}
              </Link>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
