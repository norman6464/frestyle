import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { KbRecentPage } from '@/entities/kb';
import { EmptyNotice, ErrorNotice, FsIcon, SkeletonRows } from '@/shared/ui';
import { homeCard, homeFilledButton, homeHeading, homeTextLink } from '../lib/homeStyles';
import type { HomeResource } from '../model/homeResource';
import HomeCardMark from './HomeCardMark';

export interface HomeResumeSectionProps {
  recent: HomeResource<KbRecentPage[]>;
  /** 広い画面か。初めに出す件数（3 件 / 2 件）が変わる。 */
  wide: boolean;
  /** 見出しの行の右端に置く操作（「新しくつくる」）。帯の 1 行目に、履歴の切り替えと並べる。 */
  action?: ReactNode;
}

/** カードの押せる面の焦点表示。 */
const cardFocus =
  'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600';

/**
 * 続きからはじめる（ホームの主役）。帯の上に、最近開いたページをカードで並べる。
 * カードは FreStyle の印と題名だけの静かなタイル（順位や配信元・時刻のような報道の一覧の要素や、
 * サムネイル代わりの大きな絵は持たない）。1 枚目は最後に開いたページで、2 枚ぶんの幅のカードに
 * 「続きをひらく」を置く。最終編集・未読・下書きとは言わない（閲覧の履歴だけ）。
 *
 * - 「履歴をひらく」でこの場で最大 10 件まで広げる（別の画面は作らない）
 * - コメントや変更提案の確認はページの中で行う（ホームに複製しない）
 */
export default function HomeResumeSection({ recent, wide, action }: HomeResumeSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const initialCount = wide ? 3 : 2;
  const pages = recent.data;
  const latest = pages[0];
  const rest = pages.slice(1, expanded ? pages.length : initialCount);
  const canExpand = recent.status === 'ready' && pages.length > initialCount;

  return (
    <section aria-labelledby="home-resume-heading" className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 id="home-resume-heading" className={homeHeading}>
          続きからはじめる
        </h2>
        <div className="flex items-center gap-2">
          {canExpand && (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={listId}
              onClick={() => setExpanded((open) => !open)}
              className={homeFilledButton}
            >
              {expanded ? '履歴を閉じる' : wide ? '履歴をひらく' : '履歴'}
              <FsIcon name={expanded ? 'chevron-up' : 'chevron-right'} className="h-4 w-4" />
            </button>
          )}
          {action}
        </div>
      </div>

      {recent.status === 'loading' && <SkeletonRows label="最近のページを読み込んでいます" rows={3} className="py-4" />}
      {recent.status === 'error' && (
        <ErrorNotice message="最近のページを取得できませんでした。" onRetry={recent.retry} />
      )}
      {recent.status === 'ready' && !latest && (
        <EmptyNotice variant="panel" title="表示できる履歴はありません">
          <p>ナレッジからページを探せます。お気に入りと自分の担当はそのまま使えます。</p>
          <Link to="/kb" className={`${homeTextLink} mt-1`}>
            ページを探す <FsIcon name="arrow-right" className="h-4 w-4" />
          </Link>
        </EmptyNotice>
      )}

      {recent.status === 'ready' && latest && (
        // 最後に開いたページのカード（2 枚ぶん = 369px）の右に、残りを 7px 間隔で並べる。
        // 残りは 181px を下限に、枚数が少なければ帯の幅いっぱいまで広がる（右側を空けない）。
        // 外の格子の 1 行の高さは高いほうに合わせ、中の格子は行を等分するので、カードの高さがそろう。
        <div className={rest.length > 0 ? 'grid gap-[7px] lg:grid-cols-[369px_minmax(0,1fr)]' : 'lg:max-w-[369px]'}>
          <ResumeCard page={latest} />
          {rest.length > 0 && (
            <ul
              id={listId}
              aria-label="最近開いたページ"
              className="grid auto-rows-fr grid-cols-2 gap-[7px] sm:grid-cols-3 lg:grid-cols-[repeat(auto-fit,minmax(181px,1fr))]"
            >
              {rest.map((page) => (
                <li key={page.pageId} className={`flex ${homeCard}`}>
                  <Link
                    to={`/kb/${encodeURIComponent(page.pageId)}`}
                    className={`group flex w-full flex-col gap-3 p-4 ${cardFocus}`}
                  >
                    <HomeCardMark />
                    <span className="line-clamp-3 text-base font-medium leading-6 text-[var(--color-text-primary)] [overflow-wrap:anywhere] underline-offset-4 group-hover:underline">
                      {page.title || '無題'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

/** 最後に開いたページ。カードの中で唯一「続きをひらく」を持つ。 */
function ResumeCard({ page }: { page: KbRecentPage }) {
  const headingId = useId();
  return (
    <article aria-labelledby={headingId} className={`flex flex-col gap-3 ${homeCard} p-4`}>
      <HomeCardMark className="h-6 w-6" />
      <h3 id={headingId} className="text-lg font-bold leading-7 text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
        {page.title || '無題'}
      </h3>
      <Link
        to={`/kb/${encodeURIComponent(page.pageId)}`}
        className={`${homeFilledButton} mt-auto w-full whitespace-nowrap sm:w-auto sm:self-start`}
      >
        続きをひらく <FsIcon name="arrow-right" className="h-4 w-4" />
      </Link>
    </article>
  );
}
