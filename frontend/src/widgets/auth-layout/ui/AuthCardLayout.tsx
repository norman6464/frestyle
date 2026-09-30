import type { ReactNode } from 'react';
import { useDocumentMeta } from '@/shared/lib/hooks/useDocumentMeta';
import { BrandLogo } from '@/shared/ui';

export interface AuthCardLayoutProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** カードの下段（別の入口への案内など）。線で区切って置く。 */
  footer?: ReactNode;
}

/**
 * ログイン・アカウント作成・パスワード再設定の外枠。
 *
 * 上にロゴだけの帯（アプリの上部と同じ高さ・同じ地）、その下の灰色の地に白いカードを 1 枚置く。
 * カードの上段がその画面ですること、線で区切った下段が別の入口（新規登録・ログインへ戻る）。
 * ロゴは帯の 1 つだけ。
 *
 * 狭い画面はカードの枠を外し、地を白にしてそのまま画面の幅に広げる（小さな画面で枠と余白を
 * 重ねると、入力欄の幅が削られるだけになる）。下段の区切り線は画面の端まで引く。
 */
export default function AuthCardLayout({ title, description, children, footer }: AuthCardLayoutProps) {
  // 認証の画面は検索結果に出す価値がないため noindex。
  useDocumentMeta({ robots: 'noindex, nofollow' });

  return (
    // body は overflow:hidden（AppShell の二重スクロールバー対策）なので、この画面が自分で
    // スクロールの器を持つ。
    <div className="h-full overflow-y-auto bg-surface-1 sm:bg-[var(--color-surface-band)]">
      <div className="flex min-h-full flex-col">
        <header className="app-header-surface flex h-12 flex-shrink-0 items-center justify-center px-4 md:h-[3.25rem]">
          <BrandLogo />
        </header>

        <main className="flex flex-1 flex-col items-center px-4 pb-12 pt-8 sm:px-6">
          <div className="w-full max-w-[26rem] sm:rounded-xl sm:border sm:border-surface-3 sm:bg-surface-1 sm:px-10 sm:pb-8 sm:pt-10">
            <h1 className="text-center text-xl font-bold tracking-tight text-[var(--color-text-primary)]">{title}</h1>
            {/* 中央寄せの短い説明は、語の途中（「使い始めら／れます」）で折れると読みにくい。
                auto-phrase は日本語を文節で折り返す（lang="ja" が要る。対応しないブラウザは
                ふつうの折り返しに戻るだけ）。行の長さをそろえる balance は足さない。文節で
                折れないブラウザでは「パスワ／ード」のように、かえって語の途中で折ってしまう。 */}
            {description && (
              <div className="mt-3 text-center text-sm leading-relaxed text-[var(--color-text-muted)] [word-break:auto-phrase]">
                {description}
              </div>
            )}
            <div className="mt-8">{children}</div>
            {footer && (
              <div className="-mx-4 mt-8 border-t border-surface-3 px-4 pt-6 sm:-mx-10 sm:px-10">{footer}</div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
