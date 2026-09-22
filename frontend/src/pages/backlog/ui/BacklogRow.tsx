import {
  TicketKeyBadge,
  TicketTypeGlyph,
  type Ticket,
  type TicketStatus,
  type TicketType,
} from '@/entities/ticket';

export interface BacklogRowProps {
  ticket: Ticket;
  /** チケットが属するプロジェクトの key（表示キーの組み立てに使う。例 "FRESTYLE"）。 */
  projectKey: string;
  type: TicketType | undefined;
  status: TicketStatus | undefined;
  /** 状態の選択肢。行の中で切り替えられるようにする（見本と同じ）。 */
  statuses: TicketStatus[];
  assigneeName: string;
  assigneeInitials: string;
  selected: boolean;
  busy: boolean;
  /** 変更を受け付けるか（アーカイブ中は false）。 */
  canEdit: boolean;
  /** 子チケット（parentId が現在見えている親を指す）なら字下げを出す。 */
  indented: boolean;
  onOpen: () => void;
  onChangeStatus: (statusId: string) => void;
}

/**
 * 優先度は色だけで表さない。**形も変える。**
 *
 * 上向き＝急ぐ / 横棒＝ふつう / 下向き＝後回し、と向きで分かるようにして、色はその補強に回す。
 * 文字も併記して、色や記号を知らなくても読めるようにする。
 */
const PRIORITY_VIEW: Record<number, { label: string; mark: string; className: string }> = {
  1: { label: '高', mark: '▲', className: 'text-danger-ink' },
  2: { label: '中', mark: '−', className: 'text-[var(--color-text-tertiary)]' },
  3: { label: '低', mark: '▼', className: 'text-[var(--color-text-muted)]' },
};

/** 見積りは未設定（null）と 0 を区別して出す。0 は「やることが無い」で、未設定とは別物。 */
function formatPoints(points: number | null): string {
  return points === null ? '—' : String(points);
}

/**
 * バックログ一覧の行1件。題名・識別子・補足情報と、変更操作を分ける。
 *
 * 種別 → キー → 題名 …… 優先度 → 見積り → 状態 → 担当、の順。行全体を `<button>` には
 * しない —— 中に状態の選択が入るため（押せるものを押せるもので包むと、どちらが反応したのか
 * 決まらないし、読み上げも壊れる）。開くのは題名側の帯だけが受け持つ。
 */
export default function BacklogRow({
  ticket,
  projectKey,
  type,
  status,
  statuses,
  assigneeName,
  assigneeInitials,
  selected,
  busy,
  canEdit,
  indented,
  onOpen,
  onChangeStatus,
}: BacklogRowProps) {
  const done = status?.category === 'done';
  const priority = PRIORITY_VIEW[ticket.priority] ?? PRIORITY_VIEW[2];

  return (
    <div
      aria-busy={busy || undefined}
      className={`grid w-full grid-cols-[minmax(0,1fr)_7rem] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_7rem_6rem] border-b border-surface-3 px-3 py-2 text-sm transition-colors last:border-b-0 ${
        selected ? 'bg-surface-3' : 'hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected}
        className="row-span-2 min-w-0 rounded-md py-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:row-span-1"
      >
        <span className="mb-1 flex items-center gap-2 text-xs">
        <TicketTypeGlyph type={type} />
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} className="shrink-0 tabular-nums" />
        </span>
        <span
          className={`block min-w-0 font-medium leading-relaxed [overflow-wrap:anywhere] ${done ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'}`}
        >
          {indented && (
            <span className="mr-1 text-[var(--color-text-muted)]" aria-hidden="true">
              └
            </span>
          )}
          {ticket.title}
        </span>
        <span className="mt-1.5 flex flex-wrap items-center gap-3">
      <span className={`shrink-0 text-xs leading-none ${priority.className}`}>
        <span aria-hidden="true">{priority.mark}</span>
        <span className="ml-1">{`優先度: ${priority.label}`}</span>
      </span>

      <span
        className={`shrink-0 text-xs tabular-nums ${
          ticket.storyPoints === null ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'
        }`}
        title="見積り"
      >
        見積り {formatPoints(ticket.storyPoints)}
      </span>

        </span>
      </button>

      {/* 状態はその場で変更できる。中立な枠とネイティブの矢印で入力欄を示す。 */}
      <select
        value={ticket.statusId}
        disabled={!canEdit || busy}
        aria-label={`${ticket.title} の状態`}
        onChange={(e) => onChangeStatus(e.target.value)}
        className="ui-control-compact col-start-2 w-full min-w-0 rounded-md border border-surface-3 bg-surface-1 px-2 py-1 text-sm font-medium text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-default disabled:opacity-70"
      >
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      <span className="col-start-2 flex min-w-0 items-center gap-1.5 sm:col-start-3">
      {ticket.assigneePrincipalId ? (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-taupe-500 text-[10px] font-bold text-white"
          title={assigneeName || undefined}
          aria-label={`担当: ${assigneeName || '名前未設定'}`}
        >
          {assigneeInitials}
        </span>
      ) : (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-dashed border-surface-3 text-[var(--color-text-muted)]"
          aria-label="未割り当て"
        >
          –
        </span>
      )}
      <span className="min-w-0 truncate text-xs text-[var(--color-text-muted)]" title={assigneeName || undefined}>{ticket.assigneePrincipalId ? assigneeName || '名前未設定' : '未割当'}</span>
      </span>
    </div>
  );
}
