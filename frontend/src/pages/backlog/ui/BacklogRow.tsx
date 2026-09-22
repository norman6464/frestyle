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
 * 表の列。見出し行・チケットの行・作成行が同じ列幅を共有するので 1 か所で持つ。
 * 課題 / やること / 担当 / 優先度 / 期限 / 状態（設計ボード ST08 と同じ並び）。
 * md 未満では列を捨ててカードに組み替える（BacklogRow 側の col-start で並べ直す）。
 */
export const BACKLOG_COLS_MD =
  'md:grid-cols-[minmax(7rem,auto)_minmax(0,1fr)_6.5rem_4rem_4rem_8.5rem] md:gap-x-3';
export const BACKLOG_GRID = `grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 ${BACKLOG_COLS_MD}`;

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
  onOpen: () => void;
  onChangeStatus: (statusId: string) => void;
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

/**
 * バックログ一覧の行 1 件。表の 1 行として 6 つの升を持つ。
 *
 * 広い画面では各升に列だけでなく **行（row-start-1）も明示する**。列だけを指定すると、
 * グリッドの自動配置は DOM 順に升を置いていき、直前より左の列へ戻る升を「次の行」へ送る
 * （状態を第 6 列に置いた直後の題名＝第 2 列がこれに当たる）。行を固定すれば DOM 順と
 * 見た目の列順を切り離せるので、狭い画面のカード順（キー → 状態 → 題名 → 補足）を保てる。
 *
 * 行全体を `<button>` にはしない —— 中に状態の選択が入るため（押せるものを押せるもので
 * 包むと、どちらが反応したのか決まらないし、読み上げも壊れる）。開くのは題名の升が受け持つ。
 *
 * 選択中の行は地の色だけで示さない。左端に縦罫を足して、一覧を上から眺めたときに位置が
 * すぐ分かるようにする（地の濃さの差はホバーと紛れる）。罫は未選択でも透明で場所を取り、
 * 選んだ瞬間に行がずれないようにしてある。
 *
 * md 未満はカード。キーと状態を上の行、題名を大きく、担当・優先度・期限を 1 行の補足に畳む
 * （設計ボード ST12）。列を保ったまま縮めると 375px で 6 列は読めない。
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
  onOpen,
  onChangeStatus,
}: BacklogRowProps) {
  const done = status?.category === 'done';
  const priority = PRIORITY_VIEW[ticket.priority] ?? PRIORITY_VIEW[2];
  const overdue = !done && isOverdue(ticket.dueDate, today);
  const assignee = ticket.assigneePrincipalId ? assigneeName || '名前未設定' : '未割当';
  const due = ticket.dueDate ? formatDueDateShort(ticket.dueDate) : null;

  return (
    <div
      role="row"
      aria-busy={busy || undefined}
      className={`${BACKLOG_GRID} items-center gap-y-1.5 border-b border-l-2 border-b-surface-3 px-3 py-3 text-sm transition-colors duration-fast last:border-b-0 md:min-h-14 md:py-0 sm:px-4 ${
        selected ? 'border-l-brand-600 bg-action-soft' : 'border-l-transparent hover:bg-surface-2'
      }`}
    >
      {/* 課題: 種別の印とキー。 */}
      <div role="cell" className="flex min-w-0 items-center gap-2 md:col-start-1 md:row-start-1 md:py-3">
        <TicketTypeGlyph type={type} />
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} className="shrink-0 tabular-nums" />
      </div>

      {/* 状態: 狭い画面では 1 行目の右端、広い画面では末尾の列。 */}
      <div role="cell" className="min-w-0 justify-self-end md:col-start-6 md:row-start-1 md:justify-self-stretch md:py-3">
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

      {/* やること: 題名。押すと開く。 */}
      <div role="cell" className="col-span-2 min-w-0 md:col-span-1 md:col-start-2 md:row-start-1 md:py-3">
        <button
          type="button"
          onClick={onOpen}
          aria-current={selected}
          className={`block w-full min-w-0 rounded-md text-left text-[15px] font-medium leading-relaxed [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 md:text-sm ${
            done ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'
          }`}
        >
          {indented && (
            <span className="mr-1 text-[var(--color-text-muted)]" aria-hidden="true">
              └
            </span>
          )}
          {ticket.title}
        </button>
      </div>

      {/* 担当・優先度・期限: 広い画面では列、狭い画面では 1 行の補足へ畳む。 */}
      <div role="cell" className={`hidden min-w-0 truncate md:block md:col-start-3 md:row-start-1 md:py-3 ${ticket.assigneePrincipalId ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`} title={assigneeName || undefined}>
        {assignee}
      </div>
      <div role="cell" className={`hidden items-center gap-1 whitespace-nowrap md:flex md:col-start-4 md:row-start-1 md:py-3 ${priority.className}`}>
        <FsIcon name={priority.icon} className="h-4 w-4 flex-none" />
        <span>{priority.label}</span>
      </div>
      <div role="cell" className={`hidden whitespace-nowrap tabular-nums md:block md:col-start-5 md:row-start-1 md:py-3 ${overdue ? 'font-semibold text-danger-ink' : due ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`}>
        {due ?? '—'}
        {overdue && <span className="sr-only">（期限超過）</span>}
      </div>
      <div role="cell" className="col-span-2 flex flex-wrap items-center gap-x-1 text-xs text-[var(--color-text-muted)] md:hidden">
        <span className={`inline-flex items-center gap-1 ${priority.className}`}>
          <FsIcon name={priority.icon} className="h-3.5 w-3.5 flex-none" />
          優先度 {priority.label}
        </span>
        <span aria-hidden="true">・</span>
        <span className={overdue ? 'font-semibold text-danger-ink' : undefined}>
          期限 {due ?? 'なし'}
          {overdue && <span className="sr-only">（超過）</span>}
        </span>
        <span aria-hidden="true">・</span>
        <span className="min-w-0 truncate">{assignee}</span>
        {selected && (
          <>
            <span aria-hidden="true">・</span>
            <span className="font-medium text-brand-700">選択中</span>
          </>
        )}
      </div>
    </div>
  );
}
