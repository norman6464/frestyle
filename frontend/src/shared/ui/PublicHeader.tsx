import { Link, useLocation } from 'react-router-dom';
import FsIcon from './icons/FsIcon';

/**
 * 公開ページ(ログイン / サインアップ)共通のヘッダー。
 *
 * いま居るページへのリンクを出さない — サインアップ画面で「アカウントを作成」を
 * 出すと自己参照になる。現在地の反対（ログイン⇔サインアップ）だけを案内する。
 */
export default function PublicHeader() {
  const { pathname } = useLocation();
  const onSignup = pathname === '/signup';

  return (
    <header className="w-full border-b border-surface-3 bg-surface-1">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2 [&_a]:min-h-11 [&_a]:focus-visible:outline [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-brand-600">
        <Link to="/login" className="flex items-center gap-2" aria-label="FreStyle ホーム">
          <img src="/favicon.svg" alt="" aria-hidden="true" className="h-7 w-7" />
          <span className="text-lg font-bold tracking-tight text-[var(--color-text-primary)]">
            FreStyle
          </span>
        </Link>

        <nav className="flex items-center gap-2">
          {onSignup ? (
            <Link
              to="/login"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
            >
              <FsIcon name="login" className="h-4 w-4" />
              ログイン
            </Link>
          ) : (
            <Link
              to="/signup"
              className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
            >
              <FsIcon name="user-plus" className="h-4 w-4" />
              アカウントを作成
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
