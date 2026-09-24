import { Link } from 'react-router-dom';
import { formatTicketKey, type MyAssignedTicket } from '@/entities/ticket';
import { FsIcon } from '@/shared/ui';
import { formatDueDate } from '../lib/homeDates';
import { homeTextLink } from '../lib/homeStyles';
import type { HomeResource } from '../model/useHomeResource';
import { HomeLoadingRows, HomePanelEmpty, HomePanelError } from './HomePanelState';

export interface HomeAssignedSectionProps {
  assigned: HomeResource<MyAssignedTicket[]>;
  /** 広い画面は 3 件、狭い画面は 2 件まで並べる。 */
  wide: boolean;
  /** 今日（'YYYY-MM-DD'）。期限を過ぎたかの判定に使う。 */
  today: string;
}

/** 状態の枠ごとの札の色。色だけに意味を任せず、札には状態の名前を書く。 */
function statusPillClass(category: string): string {
  if (category === 'in_progress') return 'bg-brand-50 text-brand-800';
  return 'bg-surface-2 text-[var(--color-text-secondary)]';
}

/**
 * 自分の担当（全ワークスペース横断・未完了・期限の近い順）。どの行も同じ重みで、件名・キー・
 * ワークスペース / プロジェクト・状態・期限を見比べられるようにする。先頭を大きくしない
 * （期限が近いことは「重要」や「おすすめ」と同じではない）。並びはサーバーが決めた順のまま。
 */
export default function HomeAssignedSection({ assigned, wide, today }: HomeAssignedSectionProps) {
  const shown = assigned.data.slice(0, wide ? 3 : 2);

  return (
    <section aria-labelledby="home-assigned-heading" className="min-w-0">
      <div className="flex items-center justify-between gap-3">
        <h2 id="home-assigned-heading" className="text-xl font-bold text-[var(--color-text-primary)]">
          自分の担当
        </h2>
        <Link to="/assigned" className={homeTextLink}>
          一覧へ <FsIcon name="chevron-right" className="h-4 w-4" />
        </Link>
      </div>
      <p className="text-sm text-[var(--color-text-muted)]">全ワークスペース・未完了・期限順</p>

      {assigned.status === 'loading' && <HomeLoadingRows label="自分の担当を読み込んでいます" rows={wide ? 3 : 2} />}
      {assigned.status === 'error' && (
        <div className="mt-4">
          <HomePanelError message="自分の担当を取得できませんでした。" onRetry={assigned.retry} />
        </div>
      )}
      {assigned.status === 'ready' && shown.length === 0 && (
        <div className="mt-4">
          <HomePanelEmpty title="未完了の担当はありません">
            <p>チームの次の作業は、バックログで確認できます。</p>
          </HomePanelEmpty>
        </div>
      )}
      {assigned.status === 'ready' && shown.length > 0 && (
        <>
          <ul aria-label="自分の担当" className="mt-2 divide-y divide-surface-3 border-b border-surface-3">
            {shown.map((ticket) => {
              const overdue = ticket.dueDate !== null && ticket.dueDate < today;
              return (
                <li key={ticket.id}>
                  <Link
                    to={`/tickets/${encodeURIComponent(ticket.id)}`}
                    state={{ from: '/' }}
                    className="group block rounded-lg py-5 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
                  >
                    <span className="flex items-baseline justify-between gap-3 text-sm text-[var(--color-text-muted)]">
                      <span className="font-mono">{formatTicketKey(ticket.projectKey, ticket.number)}</span>
                      {ticket.dueDate ? (
                        <span className={overdue ? 'font-semibold text-danger-ink' : undefined}>
                          期限 <time dateTime={ticket.dueDate}>{formatDueDate(ticket.dueDate)}</time>
                          {overdue && '（過ぎています）'}
                        </span>
                      ) : (
                        <span>期限なし</span>
                      )}
                    </span>
                    <span className="mt-2 block text-lg font-bold leading-snug text-[var(--color-text-primary)] [overflow-wrap:anywhere] group-hover:underline underline-offset-4">
                      {ticket.title}
                    </span>
                    <span className="mt-2 block text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
                      {ticket.workspaceName} / {ticket.projectName}
                    </span>
                    <span className={`mt-3 inline-flex rounded-md px-2 py-1 text-sm ${statusPillClass(ticket.statusCategory)}`}>
                      {ticket.statusName}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 text-sm text-[var(--color-text-muted)]">{shown.length}件を表示</p>
        </>
      )}
    </section>
  );
}
