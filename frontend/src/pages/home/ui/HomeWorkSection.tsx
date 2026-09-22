import { ArrowRightIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Link } from 'react-router-dom';
import { formatTicketKey } from '@/entities/ticket';
import { Button, ContentSection } from '@/shared/ui';
import { useHomeWork } from '../model/useHomeWork';
import { prioritizeWork, workToday } from '../model/prioritizeWork';

export default function HomeWorkSection() {
  const work = useHomeWork();
  const today = workToday();
  const tickets = prioritizeWork(work.tickets, today);
  const loaded = work.status === 'ready' || work.status === 'partial';
  const counts = [
    { label: '未完了の担当', count: tickets.length },
    { label: '進行中', count: tickets.filter((t) => t.statusCategory === 'in_progress').length },
    { label: '期限超過', count: tickets.filter((t) => t.dueDate && t.dueDate < today).length },
  ];
  return (
    <ContentSection title="取り組むチケット" description="期限超過・今日が期限のものを先に、その次に進行中の作業を表示。"
      action={<Link to="/assigned" className="ui-control-compact inline-flex items-center gap-2 rounded-md text-sm font-medium text-brand-700 hover:underline">担当課題を見る <ArrowRightIcon aria-hidden="true" className="h-4 w-4" /></Link>}>
      {work.status === 'loading' && <p role="status" className="p-5 text-sm text-[var(--color-text-muted)]">担当チケットを読み込んでいます</p>}
      {(work.status === 'error' || work.status === 'partial') && (
        <div className="flex flex-wrap items-center gap-3 border-b border-surface-3 bg-surface-2 p-4">
          <p role="alert" className="min-w-0 flex-1 text-sm">{work.status === 'partial' ? '一部の担当を取得できませんでした。表示件数は取得できた分です。' : '担当チケットを読み込めませんでした。'}</p>
          <Button variant="secondary" size="sm" onClick={work.retry}>担当を再読み込み</Button>
        </div>
      )}
      {loaded && <>
        <dl className="grid grid-cols-3 gap-3 border-b border-surface-3 px-4 py-4 sm:px-5">
          {counts.map(({ label, count }) => <div key={label}><dt className="text-xs text-[var(--color-text-muted)]">{label}</dt><dd className="mt-1 text-xl font-semibold tabular-nums">{count}<span className="ml-1 text-xs font-normal text-[var(--color-text-muted)]">件</span></dd></div>)}
        </dl>
        {tickets.length === 0 ? <div className="p-5 py-10">
          <p className="font-medium">{work.status === 'partial' ? '取得できた範囲に未完了の担当はありません' : '未完了の担当チケットはありません'}</p>
          <p className="mt-2 text-sm leading-relaxed text-[var(--color-text-muted)]">チームの次の作業はバックログから確認できます。</p>
        </div> : <ul aria-label="取り組むチケット" className="divide-y divide-surface-3">
          {tickets.slice(0, 5).map((ticket) => <li key={ticket.id}>
            <Link to={`/tickets/${encodeURIComponent(ticket.id)}`} className="group grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-4 py-4 hover:bg-surface-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600 sm:px-5">
              <span className="min-w-0">
                <span className="mb-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--color-text-muted)]"><span className="font-mono">{formatTicketKey(ticket.projectKey, ticket.number)}</span><span>{ticket.projectName}</span></span>
                <span className="block font-medium leading-relaxed [overflow-wrap:anywhere] group-hover:underline underline-offset-4">{ticket.title}</span>
                <span className="mt-2 flex flex-wrap items-center gap-3 text-xs">
                  <span className="inline-flex items-center gap-1.5 rounded bg-surface-2 px-2 py-1"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: ticket.statusColor }} />{ticket.statusName}</span>
                  {ticket.dueDate && <span className={ticket.dueDate < today ? 'font-medium text-red-700' : 'text-[var(--color-text-muted)]'}>{ticket.dueDate < today ? '期限超過' : ticket.dueDate === today ? '今日が期限' : '期限'} <time dateTime={ticket.dueDate}>{ticket.dueDate.replaceAll('-', '/')}</time></span>}
                </span>
              </span>
              <ChevronRightIcon aria-hidden="true" className="mt-6 h-4 w-4 text-[var(--color-text-muted)]" />
            </Link>
          </li>)}
        </ul>}
        {tickets.length > 5 && <p className="border-t border-surface-3 px-5 py-3 text-xs text-[var(--color-text-muted)]">{tickets.length}件中5件を表示。すべての担当は「担当課題を見る」から確認できます。</p>}
      </>}
    </ContentSection>
  );
}
