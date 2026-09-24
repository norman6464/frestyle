import { useState } from 'react';
import type { Ticket, TicketStatus, TicketType } from '@/entities/ticket';
import type { SprintState } from '@/entities/sprint';
import EmptyState from '@/shared/ui/EmptyState';
import Loading from '@/shared/ui/Loading';
import FsIllustration from '@/shared/ui/icons/FsIllustration';
import { useContainerWidth } from '@/shared/lib/hooks/useContainerWidth';
import { localTodayISO } from '../lib/dueDate';
import BacklogRow, { BACKLOG_TABLE_GRID, type BacklogRowLayout } from './BacklogRow';
import BacklogGroup from './BacklogGroup';
import TicketCreateRow from './TicketCreateRow';

/** 一覧を区切る段 1 つ。スプリント 1 件か、どのスプリントにも入っていない「バックログ」。 */
export interface BacklogGroupModel {
  /** スプリントの id、またはバックログを表す固定値。 */
  id: string;
  kind: 'sprint' | 'backlog';
  name: string;
  tickets: Ticket[];
  sprintState?: SprintState;
  /** 期間の添え書き（例 "9/1 – 9/14"）。 */
  note?: string;
}

export const BACKLOG_GROUP_ID = '__backlog__';

/**
 * 表（6 列）を保てる領域の幅。これより狭いとカードに組み替える（設計ボード ST10）。
 * 画面幅ではなく領域の幅で見る —— 画面は広くても、右に詳細が開けば一覧は狭い。
 * 題名以外の 5 列と余白で約 570px を使うので、題名に 290px ほど残る幅を境にする
 * （これより狭いと、題名が 1 文字ずつ縦に折れ始める）。
 */
export const BACKLOG_TABLE_MIN_WIDTH = 860;

export interface BacklogListProps {
  groups: BacklogGroupModel[];
  statuses: TicketStatus[];
  types: TicketType[];
  projectKey: string;
  loading: boolean;
  error: string | null;
  archived: boolean;
  filtered?: boolean;
  /** 絞り込み前の全件数。「N 件を表示・全 M 件」に使う。取れていなければ null。 */
  totalCount?: number | null;
  canEdit: boolean;
  selectedId: string | null;
  busyId: string | null;
  nameOf: (principalId: string | null) => string;
  onSelect: (ticketId: string) => void;
  /** 狭い画面で、選択中のカードから詳細を全画面で開く。渡さなければカードに「詳細をひらく」は出ない。 */
  onOpenDetail?: (ticketId: string) => void;
  onCreate: (title: string) => Promise<void>;
  onChangeStatus: (ticketId: string, statusId: string) => void;
  /** 段の見出しの右に出す操作（スプリントを開始 / 完了 / 作成）。段ごとに作る。 */
  renderGroupAction?: (group: BacklogGroupModel) => React.ReactNode;
  /** 件数の行の右端に置く操作（「この絞り込みを保存 ＋」）。無ければ件数だけ。 */
  footerAction?: React.ReactNode;
  onRetry: () => void;
}

const COLUMNS = ['課題', 'やること', '担当', '優先度', '期限', '状態'] as const;

/**
 * バックログの本文。見出し行を持つ表に、スプリントの段 → バックログの段を積み、
 * 下に件数を置く（設計ボード ST08）。並び替えは選択中の帯（BacklogSelectionBand）が持つ。
 *
 * 表は CSS グリッドで組む。`<table>` にしないのは、領域が狭いときに列を捨ててカードに
 * 組み替えるため（表の要素は列の構造を捨てられない）。役割（table / row / cell）は
 * 付けておき、読み上げでは表として辿れるようにする。
 *
 * 表かカードかは一覧の領域の幅で決める（useContainerWidth）。チケットを選んで右に詳細が
 * 開くと領域が狭くなり、自動でカードに変わる（ST10）。測れない環境では表。
 */
export default function BacklogList({
  groups,
  statuses,
  types,
  projectKey,
  loading,
  error,
  archived,
  filtered = false,
  totalCount = null,
  canEdit,
  selectedId,
  busyId,
  nameOf,
  onSelect,
  onOpenDetail,
  onCreate,
  onChangeStatus,
  renderGroupAction,
  footerAction,
  onRetry,
}: BacklogListProps) {
  // 畳んだ段だけを覚える。既定は開いた状態なので、スプリントが増えても勝手に隠れない。
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // 期限超過の判定に使う「今日」。行ごとに Date を作らず、描画 1 回につき 1 回だけ求める。
  const today = localTodayISO();
  // 読み込み中・0 件・失敗のときは一覧の器を描かないので、器が付いた・作り直されたときに
  // 測り直せるよう callback ref で受ける。
  const [containerRef, width] = useContainerWidth<HTMLDivElement>();
  const layout: BacklogRowLayout = width !== null && width < BACKLOG_TABLE_MIN_WIDTH ? 'card' : 'table';

  if (error) {
    return (
      <EmptyState
        illustration={<FsIllustration name="load-error" />}
        title="チケットを読み込めませんでした"
        description={error}
        action={{ label: '再読み込み', onClick: onRetry }}
      />
    );
  }

  const total = groups.reduce((sum, g) => sum + g.tickets.length, 0);
  if (loading && total === 0) return <Loading className="min-h-56" message="チケットを読み込んでいます" />;
  if (!loading && total === 0) {
    return (
      <div className="mx-auto max-w-xl overflow-y-auto px-4 pb-6">
        <EmptyState
          headingLevel={2}
          illustration={<FsIllustration name={filtered ? 'no-results' : archived ? 'empty-archive' : 'empty-backlog'} />}
          title={filtered ? '条件に合うチケットはありません' : archived ? 'アーカイブされたチケットはありません' : 'まだチケットがありません'}
          description={filtered ? '上の絞り込み条件を変更するか、解除して確認してください。' : archived ? 'アーカイブしたチケットはここに保管されます。必要なときに戻せます。' : 'まずは、取り組みたい作業を1つ書いてみましょう。詳しい内容はあとから追加できます。'}
        />
        {!archived && !filtered && canEdit && (
          <div role="table" aria-label="チケット" className="rounded-lg border border-surface-3">
            <TicketCreateRow onCreate={onCreate} />
          </div>
        )}
      </div>
    );
  }

  const statusOf = (id: string) => statuses.find((s) => s.id === id);
  const typeOf = (id: string) => types.find((t) => t.id === id);
  const showTotal = filtered && totalCount !== null && totalCount !== total;

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div role="table" aria-label="チケット" aria-rowcount={total} aria-busy={loading || undefined} data-layout={layout}>
          {/* 見出し行。カードのときは列を捨てるので出さない（各カードが項目名を持つ）。 */}
          {layout === 'table' && (
            <div
              role="row"
              className={`sticky top-0 z-10 border-b border-surface-3 bg-surface-2 px-3 text-xs text-[var(--color-text-muted)] sm:px-4 ${BACKLOG_TABLE_GRID}`}
            >
              {COLUMNS.map((label) => (
                <div key={label} role="columnheader" className="whitespace-nowrap py-2.5">
                  {label}
                </div>
              ))}
            </div>
          )}

          {groups.map((group) => (
            <BacklogGroup
              key={group.id}
              name={group.name}
              count={group.tickets.length}
              note={group.note}
              open={!closed[group.id]}
              onToggle={() => setClosed((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
              action={renderGroupAction?.(group)}
            >
              {group.tickets.length === 0 ? (
                <div role="row" className="border-b border-surface-3">
                  <div role="cell" aria-colspan={6} className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
                    {group.kind === 'sprint'
                      ? 'このスプリントにはまだ何も入っていません。下の一覧から選んで「スプリントへ」で入れます。'
                      : 'すべてスプリントに入っています。'}
                  </div>
                </div>
              ) : (
                group.tickets.map((ticket) => (
                  <BacklogRow
                    key={ticket.id}
                    ticket={ticket}
                    projectKey={projectKey}
                    type={typeOf(ticket.typeId)}
                    status={statusOf(ticket.statusId)}
                    statuses={statuses}
                    assigneeName={nameOf(ticket.assigneePrincipalId)}
                    selected={ticket.id === selectedId}
                    busy={ticket.id === busyId}
                    canEdit={canEdit && !archived}
                    indented={ticket.parentId !== null}
                    today={today}
                    layout={layout}
                    onOpen={() => onSelect(ticket.id)}
                    onOpenDetail={onOpenDetail ? () => onOpenDetail(ticket.id) : undefined}
                    onChangeStatus={(statusId) => onChangeStatus(ticket.id, statusId)}
                  />
                ))
              )}
              {group.kind === 'backlog' && canEdit && !archived && <TicketCreateRow onCreate={onCreate} />}
            </BacklogGroup>
          ))}
        </div>

        {/*
          件数は status で読み上げに通知する（条件を変えたら「何件になったか」が耳でも分かる）。
          取り直し中は古い一覧を出したまま「更新中」を添える —— 消して読み込み表示にすると、
          押した行がその瞬間だけ消えて選び直すことになる。
        */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-3 sm:px-4">
          <p role="status" aria-live="polite" className="text-xs tabular-nums text-[var(--color-text-muted)]">
            {total} 件の課題を表示{showTotal && <>・全 {totalCount} 件</>}
            {loading && <span className="ml-2">更新中…</span>}
          </p>
          {footerAction}
        </div>
      </div>
    </div>
  );
}
