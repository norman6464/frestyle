import type { ReactNode } from 'react';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { BrandLogo, FsIcon } from '@/shared/ui';

export interface AuthSplitLayoutProps {
  /** 見出しの上の小さな英字（飾り。読み上げない）。 */
  eyebrow: string;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** フォームの下（別の入口への案内など）。 */
  footer?: ReactNode;
}

/**
 * ログイン・アカウント作成・パスワード再設定の外枠（設計ボード ST06）。
 *
 * 広い画面は左にブランドの面（ロゴ・合言葉・2 枚の札）、右にフォーム。狭い画面は左の面を
 * 畳み、ロゴだけをフォームの上に置く。ロゴは画面に 1 つだけ（上部の帯は置かない）。
 */
export default function AuthSplitLayout({ eyebrow, title, description, children, footer }: AuthSplitLayoutProps) {
  // 認証の画面は検索結果に出す価値がないため noindex。
  useDocumentMeta({ robots: 'noindex, nofollow' });

  return (
    // body は overflow:hidden（AppShell の二重スクロールバー対策）なので、この画面が自分で
    // スクロールの器を持つ。
    <div className="h-full overflow-y-auto bg-surface">
      <div className="mx-auto grid min-h-full max-w-7xl lg:grid-cols-[minmax(0,1fr)_28rem] lg:gap-16 lg:px-16">
        <section aria-label="FreStyle について" className="hidden flex-col justify-center py-16 lg:flex">
          <BrandLogo size="hero" />
          <p aria-hidden="true" className="mt-10 font-mono text-xs font-medium uppercase tracking-[0.2em] text-brand-700">
            Think. Connect. Move.
          </p>
          <p className="mt-8 text-4xl font-bold leading-snug tracking-tight text-[var(--color-text-primary)] xl:text-5xl xl:leading-tight">
            考えたことを、
            <br />
            自分たちの次の一歩に。
          </p>
          <p className="mt-8 text-base leading-loose text-[var(--color-text-muted)]">
            メモを残す。チームでつなぐ。やることを進める。
            <br />
            あなたたちのペースで使う、ワークスペース。
          </p>
          <ul className="mt-8 grid max-w-2xl grid-cols-2 gap-3">
            <li className="rounded-2xl bg-brand-100 p-6">
              <FsIcon name="knowledge" className="h-7 w-7 text-[var(--color-text-primary)]" />
              <p className="mt-6 font-bold text-[var(--color-text-primary)]">考えを残す</p>
            </li>
            <li className="rounded-2xl bg-brand-50 p-6">
              <FsIcon name="arrow-up-right" className="h-7 w-7 text-[var(--color-text-primary)]" />
              <p className="mt-6 font-bold text-[var(--color-text-primary)]">次へ進める</p>
            </li>
          </ul>
        </section>

        <main className="flex flex-col justify-center px-4 py-10 sm:px-8 lg:px-0 lg:py-16">
          <div className="mx-auto w-full max-w-md lg:mx-0">
            <BrandLogo className="mb-8 lg:hidden" />
            <p aria-hidden="true" className="font-mono text-xs font-medium uppercase tracking-[0.2em] text-brand-700">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight text-[var(--color-text-primary)] sm:text-4xl">{title}</h1>
            {description && <div className="mt-3 text-base leading-relaxed text-[var(--color-text-muted)]">{description}</div>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 text-center text-sm text-[var(--color-text-muted)]">{footer}</div>}
          </div>
        </main>
      </div>
    </div>
  );
}
