import { Link } from 'react-router-dom';
import { ErrorNotice, FsIcon } from '@/shared/ui';
import { homeBoxRow } from '../lib/homeStyles';
import type { HomeResource } from '../model/homeResource';

export interface HomeUnreadNoticeProps {
  unread: HomeResource<number>;
  /** 広い画面は右の脇柱の箱の中の白い段、狭い画面は帯の下の 1 行。 */
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
      <ErrorNotice
        variant="inline"
        politeness="polite"
        message="未読の通知の件数を取得できませんでした。"
        onRetry={unread.retry}
      />
    );
  }
  if (unread.data <= 0) return null;

  if (!wide) {
    return (
      <Link
        to="/notifications"
        className="flex min-h-12 items-center gap-3 rounded-md bg-brand-100 px-4 text-sm font-bold text-brand-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
      >
        <FsIcon name="bell" className="h-5 w-5 shrink-0" />
        <span className="flex-1">未読の通知 {unread.data}件</span>
        <FsIcon name="arrow-right" className="h-5 w-5 shrink-0" />
      </Link>
    );
  }
  // 脇柱の箱の中の白い段。1 行目に鈴と件数、2 行目に入口（横に詰めると文が折れるので分ける）。
  return (
    <section aria-labelledby="home-unread-heading" className={`${homeBoxRow} flex-wrap gap-y-0`}>
      <FsIcon name="bell" className="h-5 w-5 shrink-0 text-brand-700" />
      <h2 id="home-unread-heading" className="min-w-0 flex-1 text-sm font-bold text-[var(--color-text-primary)]">
        未読の通知が{unread.data}件あります
      </h2>
      <Link
        to="/notifications"
        className="ml-8 inline-flex min-h-9 basis-full items-center gap-1 rounded-md text-sm font-bold text-brand-700 underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        通知一覧をひらく <FsIcon name="arrow-right" className="h-4 w-4" />
      </Link>
    </section>
  );
}
