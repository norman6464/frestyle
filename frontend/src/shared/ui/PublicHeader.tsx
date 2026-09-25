import { Link, useLocation } from 'react-router-dom';
import { hasAuthHint } from '@/shared/lib/authHint';
import BrandLogo from './BrandLogo';
import FsIcon from './icons/FsIcon';

const linkClass =
  'inline-flex min-h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

/**
 * 公開ページ（招待リンク・404 など、ログインの前にも開く画面）で共通のヘッダー。
 *
 * - ロゴは 1 つだけ。押すとホーム（/）へ（読み上げ名と行き先を一致させる）
 * - ログイン済みなら「ホームへ」だけを出し、「ログイン」「アカウントを作成」は出さない
 * - 未ログインなら、いま居るページ以外の入口（ログイン・アカウントを作成）を出す
 *
 * ログイン済みかは目印（authHint）で見る。認証の外に置く画面なので、実際の確認を待つと
 * 表示が遅れる。ここは入口の出し分けだけで、権限は判定しない。
 */
export default function PublicHeader() {
  const { pathname } = useLocation();
  const signedIn = hasAuthHint();

  return (
    <header className="w-full border-b border-surface-3 bg-surface-1">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-1.5">
        <BrandLogo />
        <nav aria-label="入口" className="flex items-center gap-1">
          {signedIn ? (
            <Link to="/" className={linkClass}>
              <FsIcon name="home" className="h-4 w-4" />
              ホームへ
            </Link>
          ) : (
            <>
              {pathname !== '/login' && (
                <Link to="/login" className={linkClass}>
                  <FsIcon name="login" className="h-4 w-4" />
                  ログイン
                </Link>
              )}
              {pathname !== '/signup' && (
                <Link to="/signup" className={linkClass}>
                  <FsIcon name="user-plus" className="h-4 w-4" />
                  アカウントを作成
                </Link>
              )}
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
