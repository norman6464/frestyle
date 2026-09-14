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
 * 見本と同じく行には印だけを置き、「高」「中」「低」の文字は出さない（読み上げには残す）。
 */
const PRIORITY_VIEW: Record<number, { label: string; mark: string; className: string }> = {
  1: { label: '高', mark: '▲', className: 'text-red-600' },
  2: { label: '中', mark: '−', className: 'text-[var(--color-text-tertiary)]' },
  3: { label: '低', mark: '▼', className: 'text-[var(--color-text-muted)]' },
};

/** 見積りは未設定（null）と 0 を区別して出す。0 は「やることが無い」で、未設定とは別物。 */
function formatPoints(points: number | null): string {
  return points === null ? '—' : String(points);
}

/**
 * バックログ一覧の行 1 件。見本と同じ **1 行**組み。
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
      className={`flex w-full items-center gap-2 border-b border-surface-3 pr-3 text-sm transition-colors last:border-b-0 ${
        selected ? 'bg-surface-3' : 'hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected}
        className="flex min-w-0 flex-1 items-center gap-2 py-2 pl-3 text-left outline-none focus-visible:bg-surface-2"
      >
        <TicketTypeGlyph type={type} />
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} className="shrink-0 tabular-nums" />
        <span
          className={`min-w-0 truncate ${done ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'}`}
        >
          {indented && (
            <span className="mr-1 text-[var(--color-text-muted)]" aria-hidden="true">
              └
            </span>
          )}
          {ticket.title}
        </span>
      </button>

      <span className={`shrink-0 text-xs leading-none ${priority.className}`}>
        <span aria-hidden="true">{priority.mark}</span>
        <span className="sr-only">{`優先度: ${priority.label}`}</span>
      </span>

      <span
        className={`w-6 shrink-0 text-right text-xs tabular-nums ${
          ticket.storyPoints === null ? 'text-[var(--color-text-faint)]' : 'text-[var(--color-text-secondary)]'
        }`}
        title="見積り"
      >
        {formatPoints(ticket.storyPoints)}
      </span>

      {/* 状態はここで変えられる（見本と同じ）。押せることが分かるよう、素の `select` の
          ドロップダウン印をそのまま残し、枠の色だけ状態マスタの色に合わせる。 */}
      <select
        value={ticket.statusId}
        disabled={!canEdit || busy}
        aria-label={`${ticket.title} の状態`}
        onChange={(e) => onChangeStatus(e.target.value)}
        className="w-28 shrink-0 rounded border bg-transparent px-1.5 py-0.5 text-xs font-medium disabled:cursor-default disabled:opacity-70"
        style={{ borderColor: status?.color ?? 'var(--color-surface-3)', color: status?.color ?? undefined }}
      >
        {statuses.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>

      {ticket.assigneePrincipalId ? (
        <span
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-taupe-500 text-[10px] font-bold text-white"
          title={assigneeName || undefined}
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
    </div>
  );
}
