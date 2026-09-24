import { useState } from 'react';
import { formatTicketKey, type Ticket } from '@/entities/ticket';
import type { Sprint, SprintInput } from '@/entities/sprint';
import { FsIcon } from '@/shared/ui';
import { formatPeriodShort } from '../lib/dueDate';

export interface SprintCardProps {
  sprint: Sprint;
  canEdit: boolean;
  busy: boolean;
  onChangeState: (state: 'active' | 'completed') => void;
  onUpdate: (input: SprintInput) => void;
  onDelete: () => void;
  /** このスプリントに入っているチケット（並び順）。 */
  tickets?: Ticket[];
  /** 表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）。 */
  projectKey?: string;
  onRemoveTicket?: (ticketId: string) => void;
  /**
   * スプリントの中で 1 つ動かす。バックログの並べ替えと同じ「ボタンで動かす」流儀に揃える
   * （ドラッグは入れない。BacklogReorderBar の doc 参照）。
   */
  onMoveTicket?: (ticketId: string, anchorTicketId: string, anchorAfter: boolean) => void;
}

/** 状態ごとの見た目。名前は利用者が足せないので、ここに 3 つ書き切れる。 */
const STATE_STYLE: Record<Sprint['state'], { label: string; className: string }> = {
  planned: { label: '計画中', className: 'bg-surface-3 text-[var(--color-text-secondary)]' },
  active: { label: '進行中', className: 'bg-brand-100 text-brand-700' },
  completed: { label: '完了', className: 'bg-success-soft text-success' },
};

/**
 * スプリント 1 つの枠。見出し（名前・期間・件数・操作）と、中身の置き場所を持つ。
 *
 * 中身が空のときは「ここへドラッグする」案内を出す。空の枠だけを見せると、
 * 何をすればいいのか分からないまま止まるため。
 */
export default function SprintCard({
  sprint,
  canEdit,
  busy,
  onChangeState,
  onUpdate,
  onDelete,
  tickets = [],
  projectKey = '',
  onRemoveTicket,
  onMoveTicket,
}: SprintCardProps) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const style = STATE_STYLE[sprint.state];

  return (
    <div className="mb-2 rounded-lg bg-surface-2 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-label={open ? `${sprint.name} を畳む` : `${sprint.name} を開く`}
          className="rounded p-0.5 text-[var(--color-text-secondary)] hover:bg-surface-3"
        >
          <FsIcon name="chevron-down" className={`h-4 w-4 transition-transform ${open ? '' : '-rotate-90'}`} />
        </button>

        <span className="text-sm font-bold text-[var(--color-text-primary)]">{sprint.name}</span>

        <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${style.className}`}>{style.label}</span>

        {canEdit && sprint.state !== 'completed' && (
          <button
            type="button"
            onClick={() => setEditing((prev) => !prev)}
            className="flex items-center gap-1 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
          >
            <FsIcon name="pencil" className="h-3.5 w-3.5" />
            {formatPeriod(sprint) || '日付を追加'}
          </button>
        )}
        {(!canEdit || sprint.state === 'completed') && formatPeriod(sprint) && (
          <span className="text-xs text-[var(--color-text-muted)]">{formatPeriod(sprint)}</span>
        )}

        <span className="text-xs text-[var(--color-text-muted)]">（{sprint.ticketCount} 件の作業項目）</span>

        <span className="ml-auto flex items-center gap-2">
          {canEdit && sprint.state === 'planned' && (
            <button
              type="button"
              onClick={() => onChangeState('active')}
              disabled={busy}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
            >
              スプリントを開始する
            </button>
          )}
          {canEdit && sprint.state === 'active' && (
            <button
              type="button"
              onClick={() => onChangeState('completed')}
              disabled={busy}
              className="rounded-lg border border-surface-3 bg-surface-1 px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              スプリントを完了する
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="rounded-lg px-2 py-1.5 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:text-danger-ink disabled:opacity-50"
            >
              削除
            </button>
          )}
        </span>
      </div>

      {editing && canEdit && (
        <SprintEditForm
          sprint={sprint}
          busy={busy}
          onCancel={() => setEditing(false)}
          onSubmit={(input) => {
            onUpdate(input);
            setEditing(false);
          }}
        />
      )}

      {open && tickets.length === 0 && (
        <div className="rounded-lg border border-[var(--color-border-hover)] bg-surface-1 px-4 py-6 text-center">
          <p className="text-sm font-bold text-[var(--color-text-primary)]">スプリントを計画</p>
          <p className="mx-auto mt-1 max-w-xl text-xs leading-relaxed text-[var(--color-text-secondary)]">
            バックログで行を選び、選択中の帯の「スプリントへ」からこのスプリントを選ぶと入ります。
            準備ができたら［スプリントを開始する］を選びます。
          </p>
        </div>
      )}

      {open && tickets.length > 0 && (
        <ul className="overflow-hidden rounded-lg border border-surface-3 bg-surface-1">
          {tickets.map((ticket, index) => (
            <li
              key={ticket.id}
              className="flex items-center gap-2.5 border-b border-surface-3 px-3 py-2 text-sm last:border-b-0"
            >
              <span className="shrink-0 font-mono text-xs text-[var(--color-text-muted)]">
                {formatTicketKey(projectKey, ticket.number)}
              </span>
              <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{ticket.title}</span>
              {canEdit && sprint.state !== 'completed' && onMoveTicket && (
                <>
                  <button
                    type="button"
                    // 1 つ上へ = 1 つ前の行の「手前」へ置く。
                    onClick={() => onMoveTicket(ticket.id, tickets[index - 1].id, false)}
                    disabled={busy || index === 0}
                    aria-label={`${ticket.title} を 1 つ上へ`}
                    className="shrink-0 rounded-md px-1.5 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    // 1 つ下へ = 1 つ後ろの行の「直後」へ置く。
                    onClick={() => onMoveTicket(ticket.id, tickets[index + 1].id, true)}
                    disabled={busy || index === tickets.length - 1}
                    aria-label={`${ticket.title} を 1 つ下へ`}
                    className="shrink-0 rounded-md px-1.5 py-1 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    ↓
                  </button>
                </>
              )}
              {canEdit && sprint.state !== 'completed' && onRemoveTicket && (
                <button
                  type="button"
                  onClick={() => onRemoveTicket(ticket.id)}
                  disabled={busy}
                  aria-label={`${ticket.title} をスプリントから外す`}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-[var(--color-text-muted)] transition-colors hover:bg-surface-2 hover:text-[var(--color-text-primary)] disabled:opacity-50"
                >
                  外す
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 期間の見出し。書き方はバックログ全体で 1 つ（lib/dueDate）。 */
function formatPeriod(sprint: Sprint): string {
  return formatPeriodShort(sprint.startDate, sprint.endDate);
}

interface SprintEditFormProps {
  sprint: Sprint;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: SprintInput) => void;
}

function SprintEditForm({ sprint, busy, onCancel, onSubmit }: SprintEditFormProps) {
  const [name, setName] = useState(sprint.name);
  const [startDate, setStartDate] = useState(sprint.startDate ?? '');
  const [endDate, setEndDate] = useState(sprint.endDate ?? '');
  // 終わりが始まりより前の期間は backend が 400 で拒むので、押す前に止める。
  const periodBroken = startDate !== '' && endDate !== '' && startDate > endDate;

  return (
    <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-surface-3 bg-surface-1 p-3">
      <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
        名前
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="rounded-md border border-surface-3 px-2 py-1 text-sm text-[var(--color-text-primary)] focus:border-brand-600"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
        開始
        <input
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          className="rounded-md border border-surface-3 px-2 py-1 text-sm text-[var(--color-text-primary)] focus:border-brand-600"
        />
      </label>
      <label className="flex flex-col gap-1 text-xs text-[var(--color-text-muted)]">
        終了
        <input
          type="date"
          value={endDate}
          onChange={(e) => setEndDate(e.target.value)}
          className="rounded-md border border-surface-3 px-2 py-1 text-sm text-[var(--color-text-primary)] focus:border-brand-600"
        />
      </label>
      <button
        type="button"
        onClick={() => onSubmit({ name, startDate, endDate })}
        disabled={busy || name.trim() === '' || periodBroken}
        className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
      >
        保存
      </button>
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 disabled:opacity-50"
      >
        キャンセル
      </button>
      {periodBroken && (
        <p role="alert" className="w-full text-sm text-danger-ink">
          終了は開始より後にしてください。
        </p>
      )}
    </div>
  );
}
