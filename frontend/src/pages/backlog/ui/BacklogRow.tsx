import {
  TicketKeyBadge,
  TicketTypeGlyph,
  type Ticket,
  type TicketStatus,
  type TicketType,
} from '@/entities/ticket';
import TicketStatusSelect from './TicketStatusSelect';

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
  1: { label: '高', mark: '▲', className: 'border-danger-border bg-danger-soft text-danger-ink' },
  2: { label: '中', mark: '−', className: 'border-surface-3 bg-surface-2 text-[var(--color-text-tertiary)]' },
  3: { label: '低', mark: '▼', className: 'border-surface-3 bg-surface-1 text-[var(--color-text-muted)]' },
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
 *
 * 選択中の行は地の色だけで示さない。左端に縦罫を足して、一覧を上から眺めたときに位置が
 * すぐ分かるようにする（地の濃さの差はホバーと紛れる）。罫は未選択でも透明で場所を取り、
 * 選んだ瞬間に行がずれないようにしてある。
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
  const unestimated = ticket.storyPoints === null;

  return (
    <div
      aria-busy={busy || undefined}
      className={`grid w-full grid-cols-[minmax(0,1fr)_8rem] items-center gap-x-4 gap-y-2 border-b border-l-2 border-b-surface-3 px-3 py-2.5 text-sm transition-colors duration-fast last:border-b-0 sm:grid-cols-[minmax(0,1fr)_8rem_7rem] ${
        selected
          ? 'border-l-brand-600 bg-action-soft'
          : 'border-l-transparent hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        onClick={onOpen}
        aria-current={selected}
        className="row-span-2 min-w-0 rounded-md py-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 sm:row-span-1"
      >
        <span className="flex min-w-0 items-start gap-2">
          <TicketTypeGlyph type={type} className="mt-0.5" />
          {/* キーは列として揃えたいので幅を確保する。ただし狭い画面では題名の取り分を
              奪って折り返しが増えるだけなので、揃えるのは横に余裕があるときだけにする。 */}
          <TicketKeyBadge
            projectKey={projectKey}
            number={ticket.number}
            className="mt-0.5 shrink-0 tabular-nums sm:w-[5.25rem]"
          />
          <span
            className={`min-w-0 flex-1 font-medium leading-relaxed [overflow-wrap:anywhere] ${done ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'}`}
          >
            {indented && (
              <span className="mr-1 text-[var(--color-text-muted)]" aria-hidden="true">
                └
              </span>
            )}
            {ticket.title}
          </span>
        </span>

        <span className="mt-1.5 flex flex-wrap items-center gap-1.5 pl-[1.75rem]">
          <span
            className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-semibold leading-relaxed ${priority.className}`}
          >
            <span aria-hidden="true">{priority.mark}</span>
            <span>{`優先度: ${priority.label}`}</span>
          </span>

          <span
            className={`inline-flex shrink-0 items-center whitespace-nowrap rounded border border-surface-3 px-1.5 py-0.5 text-[11px] font-semibold leading-relaxed tabular-nums ${
              unestimated
                ? 'bg-surface-1 text-[var(--color-text-muted)]'
                : 'bg-surface-2 text-[var(--color-text-secondary)]'
            }`}
          >
            見積り {formatPoints(ticket.storyPoints)}
          </span>
        </span>
      </button>

      {/* 状態はその場で変更できる。ピルの形のまま押せるようにして、行の中で浮かせない。 */}
      <TicketStatusSelect
        statuses={statuses}
        statusId={ticket.statusId}
        canEdit={canEdit}
        busy={busy}
        onChange={onChangeStatus}
        size="compact"
        label={`${ticket.title} の状態`}
        className="col-start-2 w-full justify-between"
      />

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
        <span className="min-w-0 truncate text-xs text-[var(--color-text-muted)]" title={assigneeName || undefined}>
          {ticket.assigneePrincipalId ? assigneeName || '名前未設定' : '未割当'}
        </span>
      </span>
    </div>
  );
}
