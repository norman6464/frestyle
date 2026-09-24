import {
  TicketKeyBadge,
  TicketTypeGlyph,
  type Ticket,
  type TicketStatus,
  type TicketType,
} from '@/entities/ticket';
import { FsIcon, type FsIconName } from '@/shared/ui';
import { formatDueDateShort, isOverdue } from '../lib/dueDate';
import TicketStatusSelect from './TicketStatusSelect';

/**
 * 行の形。table は 6 列の表（課題 / やること / 担当 / 優先度 / 期限 / 状態。設計ボード ST08）、
 * card はキーと状態を上の行、題名を大きく、担当・優先度・期限を 1 行の補足に畳んだカード
 * （ST10・ST12）。どちらにするかは画面幅ではなく一覧が置かれた領域の幅で決める（BacklogList）。
 */
export type BacklogRowLayout = 'table' | 'card';

/** 表の列。見出し行とチケットの行が同じ列幅を共有するので 1 か所で持つ。 */
export const BACKLOG_TABLE_GRID = 'grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)_6.5rem_4rem_4rem_8.5rem] gap-x-3';
const CARD_GRID = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1.5';

export interface BacklogRowProps {
  ticket: Ticket;
  /** チケットが属するプロジェクトの key（表示キーの組み立てに使う。例 "FRESTYLE"）。 */
  projectKey: string;
  type: TicketType | undefined;
  status: TicketStatus | undefined;
  /** 状態の選択肢。行の中で切り替えられるようにする。 */
  statuses: TicketStatus[];
  assigneeName: string;
  selected: boolean;
  busy: boolean;
  /** 変更を受け付けるか（アーカイブ中は false）。 */
  canEdit: boolean;
  /** 子チケット（parentId が現在見えている親を指す）なら字下げを出す。 */
  indented: boolean;
  /** 今日の日付 'YYYY-MM-DD'。期限超過の判定に使う。呼び出し側が 1 回だけ求めて全行へ渡す。 */
  today: string;
  layout: BacklogRowLayout;
  onOpen: () => void;
  onChangeStatus: (statusId: string) => void;
  /** 狭い画面で、選択中のカードから詳細を全画面で開く（設計ボード ST12 の「詳細をひらく →」）。 */
  onOpenDetail?: () => void;
}

/**
 * 優先度は色だけで表さない。**形も変える。**
 *
 * 上向き＝急ぐ / 横棒＝ふつう / 下向き＝後回し、と向きで分かるようにして、色はその補強に回す。
 * 「高」だけ主色で強める（設計ボードの通り。危険色ではなく、目を止めるための色）。
 */
const PRIORITY_VIEW: Record<number, { label: string; icon: FsIconName; className: string }> = {
  1: { label: '高', icon: 'priority-high', className: 'font-semibold text-brand-800' },
  2: { label: '中', icon: 'priority-medium', className: 'text-[var(--color-text-secondary)]' },
  3: { label: '低', icon: 'priority-low', className: 'text-[var(--color-text-muted)]' },
};

/** 行の中で押せる物（状態の選択など）の上で起きた押下か。行全体で開く判定から外す。 */
function onInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, select, textarea, [role="combobox"], [role="listbox"]') !== null;
}

/**
 * バックログ一覧の行 1 件。表の 1 行として 6 つの升を持つ。
 *
 * 升の DOM の順は見出しの順（課題・やること・担当・優先度・期限・状態）と同じにする。
 * 読み上げは表として DOM の順に列を辿り、Tab も DOM の順に進むので、見た目の位置だけを
 * CSS で動かすと「2 列目の見出しはやること、中身は状態」の食い違いになる。
 * card の配置は、行と列の指定（row-start / col-start）で組む。
 *
 * 行のどこを押しても開く（題名の文字だけだと 20px の高さしか押せない）。ただし行全体を
 * `<button>` にはしない —— 中に状態の選択が入るため（押せるものを押せるもので包むと、
 * どちらが反応したのか決まらないし、読み上げも壊れる）。キーボードの入口は題名のボタンで、
 * 行の押下は押せる物の上でなければ同じ「開く」に回す。
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
  selected,
  busy,
  canEdit,
  indented,
  today,
  layout,
  onOpen,
  onChangeStatus,
  onOpenDetail,
}: BacklogRowProps) {
  const done = status?.category === 'done';
  const priority = PRIORITY_VIEW[ticket.priority] ?? PRIORITY_VIEW[2];
  const overdue = !done && isOverdue(ticket.dueDate, today);
  const assignee = ticket.assigneePrincipalId ? assigneeName || '名前未設定' : '未割当';
  const due = ticket.dueDate ? formatDueDateShort(ticket.dueDate) : null;
  const table = layout === 'table';

  return (
    <div
      role="row"
      data-ticket-row={ticket.id}
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (onInteractive(event.target)) return;
        onOpen();
      }}
      className={`${table ? `${BACKLOG_TABLE_GRID} min-h-14 items-center` : `${CARD_GRID} py-3`} cursor-pointer border-b border-l-2 border-b-surface-3 px-3 text-sm transition-colors duration-fast last:border-b-0 sm:px-4 ${
        selected ? 'border-l-brand-600 bg-action-soft' : 'border-l-transparent hover:bg-surface-2'
      }`}
    >
      {/* 課題: 種別の印とキー。 */}
      <div role="cell" className={`flex min-w-0 items-center gap-2 ${table ? 'col-start-1 py-3' : 'col-start-1 row-start-1'}`}>
        <TicketTypeGlyph type={type} />
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} className="shrink-0 tabular-nums" />
      </div>

      {/* やること: 題名。押すと開く。キーボードの入口はここ。 */}
      <div role="cell" className={`min-w-0 ${table ? 'col-start-2 py-3' : 'col-span-2 row-start-2'}`}>
        <button
          type="button"
          data-ticket-open={ticket.id}
          onClick={onOpen}
          aria-current={selected}
          className={`block w-full min-w-0 rounded-md text-left font-medium leading-relaxed [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
            table ? 'text-sm' : 'text-[15px]'
          } ${done ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'}`}
        >
          {indented && (
            <span className="mr-1 text-[var(--color-text-muted)]" aria-hidden="true">
              └
            </span>
          )}
          {ticket.title}
        </button>
      </div>

      {/* 担当・優先度・期限: 表では列、カードでは 1 行の補足へ畳む。 */}
      {table && (
        <>
          <div role="cell" className={`col-start-3 min-w-0 truncate py-3 ${ticket.assigneePrincipalId ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`} title={assigneeName || undefined}>
            {assignee}
          </div>
          <div role="cell" className={`col-start-4 flex items-center gap-1 whitespace-nowrap py-3 ${priority.className}`}>
            <FsIcon name={priority.icon} className="h-4 w-4 flex-none" />
            <span>{priority.label}</span>
          </div>
          <div role="cell" className={`col-start-5 whitespace-nowrap py-3 tabular-nums ${overdue ? 'font-semibold text-danger-ink' : due ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`}>
            {due ?? '—'}
            {overdue && <span className="sr-only">（期限超過）</span>}
          </div>
        </>
      )}
      {/* 状態: カードでは 1 行目の右端、表では末尾の列。 */}
      <div role="cell" className={`min-w-0 ${table ? 'col-start-6 py-3' : 'col-start-2 row-start-1 justify-self-end'}`}>
        <TicketStatusSelect
          statuses={statuses}
          statusId={ticket.statusId}
          canEdit={canEdit}
          busy={busy}
          onChange={onChangeStatus}
          size="compact"
          label={`${ticket.title} の状態`}
          className="w-full"
        />
      </div>
      {!table && (
        <div role="cell" className="col-span-2 row-start-3 flex flex-wrap items-center gap-x-1 text-xs text-[var(--color-text-muted)]">
          <span className="min-w-0 truncate">{assignee}</span>
          <span aria-hidden="true">・</span>
          <span className={`inline-flex items-center gap-1 ${priority.className}`}>
            <FsIcon name={priority.icon} className="h-3.5 w-3.5 flex-none" />
            {priority.label}
          </span>
          <span aria-hidden="true">・</span>
          <span className={overdue ? 'font-semibold text-danger-ink' : undefined}>
            {due ?? '期限なし'}
            {overdue && <span className="sr-only">（期限超過）</span>}
          </span>
          {selected && (
            <>
              <span aria-hidden="true">・</span>
              <span className="font-medium text-brand-700">選択中</span>
            </>
          )}
        </div>
      )}
      {!table && selected && onOpenDetail && (
        <div role="cell" className="col-span-2 row-start-4">
          <button
            type="button"
            onClick={onOpenDetail}
            className="inline-flex min-h-11 items-center gap-1 rounded-md px-1 text-sm font-medium text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            詳細をひらく
            <FsIcon name="arrow-right" className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
}
