import { ReactNode } from 'react';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';

interface AuthLayoutProps {
  children: ReactNode;
  title?: string;
  description?: string;
  footer?: ReactNode;
  /** ページ上部に固定するヘッダー(公開ページの導線など)。省略時は従来どおり中央寄せのみ。 */
  header?: ReactNode;
}

export default function AuthLayout({ children, title, description, footer, header }: AuthLayoutProps) {
  // 認証フロー画面(ログイン/パスワード再設定)は検索結果に出す価値がないため noindex。
  useDocumentMeta({ robots: 'noindex, nofollow' });

  return (
    // body は overflow:hidden(AppShell の二重スクロールバー対策)のため、公開ページは
    // 自身がスクロールコンテナを持つ。内側の min-h-full で短いコンテンツは従来どおり中央寄せ。
    <div className="h-full overflow-y-auto bg-surface">
      <div className="min-h-full flex flex-col">
        {header}

        <main className="flex flex-1 flex-col items-center justify-center px-4 py-8 sm:py-12">
          <div className="w-full max-w-md rounded-2xl border border-surface-3 bg-surface-1 p-5 sm:p-8">
            {/* ロゴは上部のヘッダーに 1 つだけ置く（カードの中に重ねて出さない）。 */}
            <div className="mb-7">
              {title && (
                <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text-primary)]">{title}</h1>
              )}
              {description && <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</p>}
            </div>
            {children}
          </div>

          {footer && (
            <div className="mt-5 w-full max-w-md text-center text-sm">
              {footer}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
