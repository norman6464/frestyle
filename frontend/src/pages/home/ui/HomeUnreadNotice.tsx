import { Link } from 'react-router-dom';
import { FsIcon } from '@/shared/ui';
import type { HomeResource } from '../model/useHomeResource';

export interface HomeUnreadNoticeProps {
  unread: HomeResource<number>;
  /** 広い画面は右の列の面、狭い画面は見出しの下の 1 行。 */
  wide: boolean;
}

/**
 * 未読の通知の件数と、通知一覧への入口だけ。0 件なら出さない（上部の鈴はそのまま残る）。
 * 「未読」は「自分の返信待ち」「承認待ち」ではないので、そう読める言い方はしない。
 * 件数が取れなかったときは 0 件のふりをせず、小さく知らせて読み直せるようにする。
 */
export default function HomeUnreadNotice({ unread, wide }: HomeUnreadNoticeProps) {
  if (unread.status === 'loading') return null;
  if (unread.status === 'error') {
    return (
      <p className="flex flex-wrap items-center gap-2 text-sm text-[var(--color-text-muted)]">
        <span role="alert">未読の通知の件数を取得できませんでした。</span>
        <button
          type="button"
          onClick={unread.retry}
          className="inline-flex min-h-11 items-center rounded-md font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          再試行
        </button>
      </p>
    );
  }
  if (unread.data <= 0) return null;

  if (!wide) {
    return (
      <Link
        to="/notifications"
        className="flex min-h-12 items-center gap-3 rounded-xl bg-brand-100 px-4 font-medium text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <FsIcon name="bell" className="h-5 w-5 shrink-0" />
        <span className="flex-1">未読の通知 {unread.data}件</span>
        <FsIcon name="arrow-right" className="h-5 w-5 shrink-0" />
      </Link>
    );
  }
  return (
    <section aria-labelledby="home-unread-heading" className="rounded-2xl bg-brand-100 p-6">
      <h2 id="home-unread-heading" className="flex items-center gap-3 text-lg font-bold text-[var(--color-text-primary)]">
        <FsIcon name="bell" className="h-6 w-6 shrink-0 text-brand-700" />
        未読の通知が{unread.data}件あります
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-secondary)]">
        メンションや、担当しているチケットへのコメントを確認できます。
      </p>
      <Link
        to="/notifications"
        className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md font-semibold text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        通知一覧をひらく <FsIcon name="arrow-right" className="h-4 w-4" />
      </Link>
    </section>
  );
}
