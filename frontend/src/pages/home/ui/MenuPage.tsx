import {
  ArrowRightIcon,
  BellIcon,
  BookOpenIcon,
  DocumentTextIcon,
} from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { Button, PageFrame, PageHeader } from '@/shared/ui';
import HomeWorkSection from './HomeWorkSection';
import { useRecentPages } from '../model/useRecentPages';

const recentPreviewLimit = 3;
const viewedAtFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

function viewedAtLabel(value: string): string {
  return viewedAtFormatter.format(new Date(value));
}

/** 既存の機能で「続き」と「次の行動」へ戻るためのホーム。 */
export default function MenuPage() {
  const { pages, status, retry } = useRecentPages();

  return (
    <PageFrame>
      <PageHeader title="ホーム" description="担当の作業と、最近開いたナレッジから再開できます。"
        action={<Link to="/backlog" className="ui-control-compact inline-flex items-center gap-2 rounded-md text-sm font-medium text-brand-700 hover:underline">バックログを開く <ArrowRightIcon aria-hidden="true" className="h-4 w-4" /></Link>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,1fr)] xl:items-start">
        <HomeWorkSection />
        <section aria-labelledby="recent-pages-heading" className="min-w-0 rounded-xl border border-[var(--color-surface-3)] bg-[var(--color-surface-1)]">
          <div className="border-b border-[var(--color-surface-3)] px-5 py-5 sm:px-5">
            <h2 id="recent-pages-heading" className="text-base font-semibold text-[var(--color-text-primary)]">最近見たページ</h2>
            <p className="mt-1 text-sm text-[var(--color-text-muted)]">読んでいた場所へ、すぐに戻れます。</p>
          </div>

          {status === 'loading' && (
            <p role="status" className="px-5 py-8 text-sm text-[var(--color-text-muted)] sm:px-5">最近のページを読み込んでいます</p>
          )}
          {status === 'error' && (
            <div className="space-y-4 px-5 py-8 sm:px-5">
              <p role="alert" className="text-sm text-[var(--color-text-primary)]">最近のページを読み込めませんでした。</p>
              <Button variant="secondary" onClick={retry}>再試行</Button>
            </div>
          )}
          {status === 'ready' && pages.length === 0 && (
            <div className="space-y-3 px-5 py-8 sm:px-5">
              <p className="text-sm text-[var(--color-text-primary)]">表示できる履歴はありません</p>
              <p className="text-sm text-[var(--color-text-muted)]">ナレッジからページを探せます。</p>
              <Link to="/kb" className="inline-flex min-h-11 items-center gap-2 font-medium text-brand-700 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
                ページを探す <ArrowRightIcon aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          )}
          {status === 'ready' && pages.length > 0 && (
            <ul aria-label="最近見たページ" className="divide-y divide-[var(--color-surface-3)]">
              {pages.slice(0, recentPreviewLimit).map((page) => (
                <li key={page.pageId}>
                  <Link
                    to={`/kb/${encodeURIComponent(page.pageId)}`}
                    className="group flex min-h-16 items-center gap-4 px-5 py-4 hover:bg-[var(--color-surface-2)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 sm:px-5"
                  >
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-brand-700">
                      <DocumentTextIcon className="h-5 w-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words text-sm font-medium text-[var(--color-text-primary)] group-hover:text-brand-700">{page.title}</span>
                      <span className="mt-1 block break-words text-sm text-[var(--color-text-muted)]">{page.spaceName} · {page.workspaceSlug}</span>
                      <time className="mt-1 block text-xs text-[var(--color-text-muted)]" dateTime={page.viewedAt}>
                        {viewedAtLabel(page.viewedAt)} に閲覧
                      </time>
                    </span>
                    <ArrowRightIcon aria-hidden="true" className="h-5 w-5 shrink-0 text-[var(--color-text-muted)]" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>


      </div>

      <nav aria-label="その他の移動先" className="mt-5 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--color-surface-3)] pt-5 text-sm">
        <Link to="/kb" className="inline-flex min-h-11 items-center gap-2 text-[var(--color-text-secondary)] hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          <BookOpenIcon aria-hidden="true" className="h-5 w-5" />ナレッジを開く
        </Link>
        <Link to="/notifications" className="inline-flex min-h-11 items-center gap-2 text-[var(--color-text-secondary)] hover:text-brand-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600">
          <BellIcon aria-hidden="true" className="h-5 w-5" />通知を確認
        </Link>
      </nav>
    </PageFrame>
  );
}
