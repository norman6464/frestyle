import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import type { KbRecentPage } from '@/entities/kb';
import { formatTicketKey, type TicketReference } from '@/entities/ticket';
import { FsIcon } from '@/shared/ui';
import { formatViewedAt } from '../lib/homeDates';
import { homePrimaryLink, homeRowLink, homeTextLink } from '../lib/homeStyles';
import type { HomeResource } from '../model/useHomeResource';
import { HomeLoadingRows, HomePanelEmpty, HomePanelError } from './HomePanelState';

export interface HomeResumeSectionProps {
  recent: HomeResource<KbRecentPage[]>;
  /** 最後に開いたページを参照しているチケット（最新の 1 ページ分だけ）。 */
  references: HomeResource<TicketReference[]>;
  /** slug からワークスペースの表示名を引く（履歴の応答には slug しか無い）。 */
  workspaceName: (slug: string) => string;
  /** 広い画面か。初めに出す件数（3 件 / 2 件）と、参照チケットを畳むかが変わる。 */
  wide: boolean;
}

/**
 * 続きからはじめる（ホームの主役）。最後に開いた、今も閲覧できるページを大きなカードで出し、
 * 「続きをひらく」でそのページへ戻る。最終編集・未読・下書きとは言わない（閲覧の履歴だけ）。
 *
 * - カードの下に、そのページを本文で参照しているチケットを最大 2 行（無ければ節ごと出さない）
 * - 残りの履歴は短い行で。「履歴をひらく」でこの場で最大 10 件まで広げる（別の画面は作らない）
 * - コメントや変更提案の確認はページの中で行う（ホームに複製しない）
 */
export default function HomeResumeSection({ recent, references, workspaceName, wide }: HomeResumeSectionProps) {
  const [expanded, setExpanded] = useState(false);
  const listId = useId();
  const initialCount = wide ? 3 : 2;
  const pages = recent.data;
  const latest = pages[0];
  const rest = pages.slice(1, expanded ? pages.length : initialCount);
  const canExpand = recent.status === 'ready' && pages.length > initialCount;

  return (
    <section aria-labelledby="home-resume-heading" className="min-w-0">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 id="home-resume-heading" className="text-xl font-bold text-[var(--color-text-primary)]">
          続きからはじめる
        </h2>
        {canExpand && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={listId}
            onClick={() => setExpanded((open) => !open)}
            className={homeTextLink}
          >
            {expanded ? '履歴を閉じる' : wide ? '履歴をひらく' : '履歴'}
            <FsIcon name={expanded ? 'chevron-up' : 'chevron-right'} className="h-4 w-4" />
          </button>
        )}
      </div>

      {recent.status === 'loading' && <HomeLoadingRows label="最近のページを読み込んでいます" rows={3} />}
      {recent.status === 'error' && (
        <HomePanelError message="最近のページを取得できませんでした。" onRetry={recent.retry} />
      )}
      {recent.status === 'ready' && !latest && (
        <HomePanelEmpty title="表示できる履歴はありません">
          <p>ナレッジからページを探せます。お気に入りと自分の担当はそのまま使えます。</p>
          <Link to="/kb" className={`${homeTextLink} mt-1`}>
            ページを探す <FsIcon name="arrow-right" className="h-4 w-4" />
          </Link>
        </HomePanelEmpty>
      )}

      {recent.status === 'ready' && latest && (
        <>
          <ResumeCard page={latest} references={references} workspaceName={workspaceName} wide={wide} />
          {rest.length > 0 && (
            <ul id={listId} aria-label="最近開いたページ" className="mt-4 divide-y divide-surface-3 border-b border-surface-3">
              {rest.map((page) => (
                <li key={page.pageId}>
                  <Link to={`/kb/${encodeURIComponent(page.pageId)}`} className={homeRowLink}>
                    <FsIcon name="document-text" className="h-6 w-6 shrink-0 text-[var(--color-text-muted)]" />
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere] group-hover:text-brand-700">
                        {page.title || '無題'}
                      </span>
                      <span className="mt-1 block text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
                        {workspaceName(page.workspaceSlug)} / {page.spaceName}
                      </span>
                    </span>
                    <time dateTime={page.viewedAt} className="shrink-0 text-sm tabular-nums text-[var(--color-text-muted)]">
                      {formatViewedAt(page.viewedAt)}
                    </time>
                    <FsIcon name="arrow-up-right" className="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function ResumeCard({
  page,
  references,
  workspaceName,
  wide,
}: {
  page: KbRecentPage;
  references: HomeResource<TicketReference[]>;
  workspaceName: (slug: string) => string;
  wide: boolean;
}) {
  const headingId = useId();
  return (
    <article
      aria-labelledby={headingId}
      className="rounded-2xl border-l-4 border-brand-100 bg-surface-1 p-6 sm:p-8"
    >
      <p className="flex items-center gap-2 text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
        <FsIcon name="document-text" className="h-5 w-5 shrink-0 text-brand-600" />
        {workspaceName(page.workspaceSlug)} / {page.spaceName}
      </p>
      <h3
        id={headingId}
        className="mt-4 text-2xl font-bold leading-snug text-[var(--color-text-primary)] [overflow-wrap:anywhere] sm:text-3xl"
      >
        {page.title || '無題'}
      </h3>
      <p className="mt-4 text-sm text-[var(--color-text-muted)]">
        最後に開いた日時：<time dateTime={page.viewedAt}>{formatViewedAt(page.viewedAt)}</time>
      </p>
      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-4">
        <Link to={`/kb/${encodeURIComponent(page.pageId)}`} className={`${homePrimaryLink} w-full sm:w-auto`}>
          続きをひらく <FsIcon name="arrow-right" className="h-5 w-5" />
        </Link>
        <p className="text-sm text-[var(--color-text-muted)]">コメント・変更提案の確認はページ内で</p>
      </div>
      <PageReferences references={references} wide={wide} />
    </article>
  );
}

/**
 * このページを参照しているチケット。0 件なら節ごと出さない（空の飾りや架空の行で埋めない）。
 * 取得に失敗したら小さく知らせて読み直せるようにする（ページの再開は止めない）。
 * 狭い画面では畳んで出し、押すと開く。
 */
function PageReferences({ references, wide }: { references: HomeResource<TicketReference[]>; wide: boolean }) {
  const [open, setOpen] = useState(false);
  const labelId = useId();
  const listId = useId();

  if (references.status === 'loading') return null;
  if (references.status === 'error') {
    return (
      <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-surface-3 pt-5 text-sm">
        <p role="alert" className="text-[var(--color-text-muted)]">
          このページを参照しているチケットを取得できませんでした。
        </p>
        <button type="button" onClick={references.retry} className={homeTextLink}>
          再試行
        </button>
      </div>
    );
  }
  if (references.data.length === 0) return null;

  const list = (
    <ul id={listId} aria-labelledby={labelId} className="mt-2">
      {references.data.map((ticket) => (
        <li key={ticket.id}>
          <Link
            to={`/tickets/${encodeURIComponent(ticket.id)}`}
            state={{ from: '/' }}
            className="group flex min-h-11 items-center gap-3 rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <FsIcon name="link" className="h-5 w-5 shrink-0 text-brand-600" />
            <span className="min-w-0 flex-1 text-[var(--color-text-primary)] [overflow-wrap:anywhere] group-hover:underline underline-offset-4">
              <span className="sr-only">{formatTicketKey(ticket.projectKey, ticket.number)} </span>
              {ticket.title}
            </span>
            <FsIcon name="arrow-up-right" className="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
          </Link>
        </li>
      ))}
    </ul>
  );

  if (wide) {
    return (
      <div className="mt-6 border-t border-surface-3 pt-5">
        <p id={labelId} className="text-sm text-[var(--color-text-muted)]">
          このページを参照しているチケット
        </p>
        {list}
      </div>
    );
  }
  return (
    <div className="mt-6 border-t border-surface-3 pt-3">
      <button
        type="button"
        id={labelId}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className={`${homeTextLink} w-full justify-between`}
      >
        このページを参照しているチケット
        <FsIcon name={open ? 'chevron-up' : 'chevron-down'} className="h-5 w-5" />
      </button>
      {open && list}
    </div>
  );
}
