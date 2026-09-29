import { memo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  TicketKeyBadge,
  type Ticket,
  type TicketStatus,
  type TicketType,
} from '@/entities/ticket';
import { FsIcon, type FsIconName } from '@/shared/ui';
import { formatDueDateShort, isOverdue } from '../lib/dueDate';
import { ticketLinkState } from '../lib/ticketLinkState';
import type { WriteOutcome } from '../lib/writeOutcome';
import FieldFeedback from './FieldFeedback';
import TicketStatusSelect from './TicketStatusSelect';
import BacklogRowMenu from './BacklogRowMenu';

/**
 * 行の形。table は 7 列の表（課題 / やること / 担当 / 優先度 / 期限 / 状態 / 操作。設計ボード ST08）、
 * card はキーと状態を上の行、題名を大きく、担当・優先度・期限を 1 行の補足に畳んだカード
 * （ST10・ST12）。どちらにするかは画面幅ではなく一覧が置かれた領域の幅で決める（BacklogList）。
 */
export type BacklogRowLayout = 'table' | 'card';

/** 表の列。見出し行とチケットの行が同じ列幅を共有するので 1 か所で持つ。末尾は「…」の列。 */
export const BACKLOG_TABLE_GRID =
  'grid grid-cols-[minmax(7rem,auto)_minmax(0,1fr)_6.5rem_4rem_4rem_8.5rem_2.25rem] gap-x-3';
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
  busy: boolean;
  /** 変更を受け付けるか（アーカイブ中は false）。 */
  canEdit: boolean;
  /** 並び替えの「…」を出すか（アーカイブでは出さない）。 */
  canReorder: boolean;
  /** 子チケット（parentId が現在見えている親を指す）なら字下げを出す。 */
  indented: boolean;
  /** 今日の日付 'YYYY-MM-DD'。期限超過の判定に使う。呼び出し側が 1 回だけ求めて全行へ渡す。 */
  today: string;
  layout: BacklogRowLayout;
  /** このチケットが入っている段の先頭か（「1 つ上へ」を disable する）。 */
  isFirst: boolean;
  /** このチケットが入っている段の末尾か（「1 つ下へ」「末尾へ」を disable する）。 */
  isLast: boolean;
  /** いまスプリントに入っているか（「スプリントから出す」を出すかどうか）。 */
  inSprint: boolean;
  /** 入れ先に選べるスプリント（いま入っている段は除く）。段をまたいでも同じ配列でよい。 */
  otherSprints: { id: string; name: string }[];
  onChangeStatus: (ticketId: string, statusId: string) => void;
  onMoveUp: (ticketId: string) => void;
  onMoveDown: (ticketId: string) => void;
  onMoveLast: (ticketId: string) => void;
  onMoveToSprint: (ticketId: string, sprintId: string) => void;
  onRemoveFromSprint: (ticketId: string) => void;
  /** 行で状態や並びを変えた結果（PX04）。行のすぐ下に出す。 */
  outcome?: WriteOutcome | null;
  /** 結果が分からない失敗のあとの「最新を確認」。 */
  onVerify?: () => void;
}

/**
 * 優先度は色で表さない。**形と濃さで分ける。**
 *
 * 上向き＝急ぐ / 横棒＝ふつう / 下向き＝後回し、と向きで分かるようにし、「高」だけ太字の濃い文字で
 * 目を止める（バックログの画面では色を混ぜない。濃さの段は文字色のトークンだけを使う）。
 */
const PRIORITY_VIEW: Record<number, { label: string; icon: FsIconName; className: string }> = {
  1: { label: '高', icon: 'priority-high', className: 'font-semibold text-[var(--color-text-primary)]' },
  2: { label: '中', icon: 'priority-medium', className: 'text-[var(--color-text-secondary)]' },
  3: { label: '低', icon: 'priority-low', className: 'text-[var(--color-text-muted)]' },
};

/** 行の中で押せる物（状態の選択・「…」など）の上で起きた押下か。行全体で開く判定から外す。 */
function onInteractive(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('button, a, input, select, textarea, [role="combobox"], [role="listbox"], [role="menu"]') !== null;
}

/**
 * バックログ一覧の行 1 件。表の 1 行として 7 つの升を持つ。
 *
 * 升の DOM の順は見出しの順（課題・やること・担当・優先度・期限・状態・操作）と同じにする。
 * 読み上げは表として DOM の順に列を辿り、Tab も DOM の順に進むので、見た目の位置だけを
 * CSS で動かすと「2 列目の見出しはやること、中身は状態」の食い違いになる。
 * card の配置は、行と列の指定（row-start / col-start）で組む。
 *
 * 行のどこを押しても開く（題名の文字だけだと 20px の高さしか押せない）。開くのは独立した票
 * （/tickets/:id）で、一覧の上に重ねる面は持たない —— ページが増える代わりに、一覧はこの表
 * だけの単純な画面のままにする。行全体を `<a>` にはしない —— 中に状態の選択と並び替えの「…」が
 * 入るため（押せるものを押せるもので包むと、どちらが反応したのか決まらないし、読み上げも壊れる）。
 * キーボードの入口は題名のリンクで、行の押下は押せる物の上でなければ同じ「開く」に回す。
 *
 * 文字と空きは報道系サイトの記事面の一覧に寄せる。題名は 15px の太字・行送り 1.6、ほかの升は 14px、
 * 行の上下は 16px ずつ空ける。色は付けない（種別は名前、期限切れは太字と印、優先度は向きと濃さで示す）。
 */
function BacklogRow({
  ticket,
  projectKey,
  type,
  status,
  statuses,
  assigneeName,
  busy,
  canEdit,
  canReorder,
  indented,
  today,
  layout,
  isFirst,
  isLast,
  inSprint,
  otherSprints,
  onChangeStatus,
  onMoveUp,
  onMoveDown,
  onMoveLast,
  onMoveToSprint,
  onRemoveFromSprint,
  outcome = null,
  onVerify,
}: BacklogRowProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const done = status?.category === 'done';
  const priority = PRIORITY_VIEW[ticket.priority] ?? PRIORITY_VIEW[2];
  const overdue = !done && isOverdue(ticket.dueDate, today);
  const assignee = ticket.assigneePrincipalId ? assigneeName || '名前未設定' : '未割当';
  const due = ticket.dueDate ? formatDueDateShort(ticket.dueDate) : null;
  const table = layout === 'table';
  const ticketPath = `/tickets/${ticket.id}`;
  const openTicket = () => navigate(ticketPath, { state: ticketLinkState(location) });
  const menu = canReorder ? (
    <BacklogRowMenu
      ticketTitle={ticket.title}
      isFirst={isFirst}
      isLast={isLast}
      inSprint={inSprint}
      otherSprints={otherSprints}
      onMoveUp={() => onMoveUp(ticket.id)}
      onMoveDown={() => onMoveDown(ticket.id)}
      onMoveLast={() => onMoveLast(ticket.id)}
      onMoveToSprint={(sprintId) => onMoveToSprint(ticket.id, sprintId)}
      onRemoveFromSprint={() => onRemoveFromSprint(ticket.id)}
    />
  ) : null;

  return (
    <div
      role="row"
      aria-busy={busy || undefined}
      onClick={(event) => {
        if (onInteractive(event.target)) return;
        openTicket();
      }}
      className={`${table ? `${BACKLOG_TABLE_GRID} min-h-16 items-center` : `${CARD_GRID} py-4`} cursor-pointer border-b border-b-surface-3 px-3 text-sm transition-colors duration-fast last:border-b-0 hover:bg-surface-2 sm:px-4`}
    >
      {/*
        課題: キーと種別。種別は色の印ではなく名前で出す（詳細の「キー・種別」と同じ言い方）。表ではキーの
        下に小さく、カードではキーの右に並べる。表の列は行ごとの grid なので、種別の名前が長くても列の幅を
        押し広げないよう、最小幅（7rem）で切る（行ごとに列の幅がずれると表が崩れる）。
      */}
      <div
        role="cell"
        className={`flex min-w-0 ${table ? 'col-start-1 flex-col items-start gap-0.5 py-4' : 'col-start-1 row-start-1 items-center gap-1.5'}`}
      >
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} className="shrink-0 tabular-nums" />
        {type && !table && (
          <span aria-hidden="true" className="text-[var(--color-text-faint)]">
            ・
          </span>
        )}
        {type && (
          <span
            title={type.name}
            className={`min-w-0 truncate text-xs text-[var(--color-text-muted)] ${table ? 'max-w-[7rem]' : ''}`}
          >
            <span className="sr-only">種別: </span>
            {type.name}
          </span>
        )}
      </div>

      {/* やること: 題名。押すと開く。キーボードの入口はここ（独立した票へのリンク）。 */}
      <div role="cell" className={`min-w-0 ${table ? 'col-start-2 py-4' : 'col-span-2 row-start-2'}`}>
        <Link
          to={ticketPath}
          state={ticketLinkState(location)}
          className={`block w-full min-w-0 rounded-md text-left text-[15px] font-semibold leading-[1.6] [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 ${
            done ? 'text-[var(--color-text-muted)] line-through' : 'text-[var(--color-text-primary)]'
          }`}
        >
          {indented && (
            <span className="mr-1 text-[var(--color-text-muted)]" aria-hidden="true">
              └
            </span>
          )}
          {ticket.title}
        </Link>
      </div>

      {/* 担当・優先度・期限: 表では列、カードでは 1 行の補足へ畳む。 */}
      {table && (
        <>
          <div role="cell" className={`col-start-3 min-w-0 truncate py-4 ${ticket.assigneePrincipalId ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`} title={assigneeName || undefined}>
            {assignee}
          </div>
          <div role="cell" className={`col-start-4 flex items-center gap-1 whitespace-nowrap py-4 ${priority.className}`}>
            <FsIcon name={priority.icon} className="h-4 w-4 flex-none" />
            <span>{priority.label}</span>
          </div>
          <div role="cell" className={`col-start-5 flex items-center gap-1 whitespace-nowrap py-4 tabular-nums ${overdue ? 'font-semibold text-[var(--color-text-primary)]' : due ? 'text-[var(--color-text-secondary)]' : 'text-[var(--color-text-muted)]'}`}>
            {/* 期限切れは色を付けず、太さと印で示す。読み上げには言葉で伝える。 */}
            {overdue && <FsIcon name="alert-triangle" className="h-3.5 w-3.5 flex-none" />}
            {due ?? '—'}
            {overdue && <span className="sr-only">（期限超過）</span>}
          </div>
        </>
      )}
      {/* 状態: カードでは 1 行目の右端に「…」と並べる、表では末尾から 2 列目。 */}
      <div
        role="cell"
        className={`flex min-w-0 items-center gap-1 ${table ? 'col-start-6 py-4' : 'col-start-2 row-start-1 justify-self-end'}`}
      >
        <TicketStatusSelect
          statuses={statuses}
          statusId={ticket.statusId}
          canEdit={canEdit}
          busy={busy}
          onChange={(statusId) => onChangeStatus(ticket.id, statusId)}
          size="compact"
          label={`${ticket.title} の状態`}
          className="w-full"
        />
        {!table && menu}
      </div>
      {/* 操作: 並び替えの「…」。表だけの列（カードでは状態の隣に出す）。 */}
      {table && <div role="cell" className="col-start-7 flex justify-end py-4">{menu}</div>}
      {!table && (
        <div role="cell" className="col-span-2 row-start-3 flex flex-wrap items-center gap-x-1 text-[13px] text-[var(--color-text-muted)]">
          <span className="min-w-0 truncate">{assignee}</span>
          <span aria-hidden="true">・</span>
          <span className={`inline-flex items-center gap-1 ${priority.className}`}>
            <FsIcon name={priority.icon} className="h-3.5 w-3.5 flex-none" />
            {priority.label}
          </span>
          <span aria-hidden="true">・</span>
          <span className={overdue ? 'inline-flex items-center gap-1 font-semibold text-[var(--color-text-primary)]' : undefined}>
            {overdue && <FsIcon name="alert-triangle" className="h-3.5 w-3.5 flex-none" />}
            {due ?? '期限なし'}
            {overdue && <span>期限切れ</span>}
          </span>
        </div>
      )}
      {/* 行で状態や並びを変えた結果。行の全幅に 1 行で出す（どの行の結果かが位置で分かる）。 */}
      {outcome && (
        <div role="cell" className={table ? 'col-span-7 pb-2' : 'col-span-2'}>
          <FieldFeedback outcome={outcome} onVerify={onVerify} />
        </div>
      )}
    </div>
  );
}

/**
 * 渡すものが変わらない限り描き直さない。1 件の書き込み・並び替えの取り直しで、
 * 変わった行だけを描き直す（一覧は数百行になりうる）。
 */
export default memo(BacklogRow);
