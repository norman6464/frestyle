import { Link } from 'react-router-dom';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { hasAuthHint } from '@/shared/lib/authHint';

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
    <div className="h-full overflow-y-auto bg-surface-0">
    <div className="flex min-h-full flex-col [&_a]:min-h-11 [&_a]:focus-visible:outline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-brand-600">
      <header className="flex-shrink-0 h-16 border-b border-surface-3 flex items-center px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2" aria-label="FreStyle ホーム">
          <img src="/brand-mark.svg" alt="" className="w-7 h-7 flex-shrink-0" />
          <span className="text-sm font-semibold text-[var(--color-text-primary)]">FreStyle</span>
        </Link>
      </header>

      <main className="flex-1 flex items-center justify-center px-4 py-16">
        <div className="w-full max-w-md text-center">
          <p className="text-sm font-semibold tracking-widest text-brand-700">404</p>
          <h1 className="mt-2 text-2xl font-bold text-[var(--color-text-primary)]">
            ページが見つかりません
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-[var(--color-text-muted)]">
            お探しのページは移動または削除された可能性があります。
            <br />
            URL に誤りがないかご確認ください。
          </p>

          <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
            {signedIn ? (
              <Link
                to="/"
                className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
              >
                ホームへ戻る
              </Link>
            ) : (
              <>
                <Link
                  to="/"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-md bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 transition-colors"
                >
                  トップへ戻る
                </Link>
                <Link
                  to="/login"
                  className="inline-flex items-center justify-center px-5 py-2.5 rounded-md border border-surface-3 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-nav-hover)] transition-colors"
                >
                  ログイン
                </Link>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
    </div>
  );
}
