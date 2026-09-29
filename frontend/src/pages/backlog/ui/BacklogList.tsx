import { useMemo, useState } from 'react';
import type { Ticket, TicketStatus, TicketType } from '@/entities/ticket';
import type { SprintState } from '@/entities/sprint';
import { EmptyState, Loading, FsIllustration } from '@/shared/ui';
import { useContainerNarrowerThan } from '@/shared/lib/hooks/useContainerNarrowerThan';
import { useLocalToday } from '@/shared/lib/hooks/useLocalToday';
import type { WriteOutcome } from '../lib/writeOutcome';
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
 * 表（7 列）を保てる領域の幅。これより狭いとカードに組み替える（設計ボード ST10）。
 * 画面幅ではなく領域の幅で見る（狭い端末のほか、ウィンドウを分割して使う場合等も含む）。
 * 題名以外の 6 列と余白で約 600px を使うので、題名に 300px ほど残る幅を境にする
 * （これより狭いと、題名が 1 文字ずつ縦に折れ始める）。
 */
export const BACKLOG_TABLE_MIN_WIDTH = 900;

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
  busyId: string | null;
  nameOf: (principalId: string | null) => string;
  onCreate: (title: string) => Promise<void>;
  onChangeStatus: (ticketId: string, statusId: string) => void;
  onMoveUp: (ticketId: string) => void;
  onMoveDown: (ticketId: string) => void;
  onMoveLast: (ticketId: string) => void;
  onMoveToSprint: (ticketId: string, sprintId: string) => void;
  onRemoveFromSprint: (ticketId: string) => void;
  /** 行で状態や並びを変えた結果（PX04）。行のすぐ下に出す。 */
  outcomeOf?: (ticketId: string) => WriteOutcome | null;
  /** 結果が分からない失敗のあとの「最新を確認」。 */
  onVerify?: () => void;
  /** 段の見出しの右に出す操作（スプリントを開始 / 完了 / 作成）。段ごとに作る。 */
  renderGroupAction?: (group: BacklogGroupModel) => React.ReactNode;
  /** 件数の行の右端に置く操作（「この絞り込みを保存 ＋」）。無ければ件数だけ。 */
  footerAction?: React.ReactNode;
  onRetry: () => void;
}

const COLUMNS = ['課題', 'やること', '担当', '優先度', '期限', '状態', '操作'] as const;

/**
 * バックログの本文。見出し行を持つ表に、スプリントの段 → バックログの段を積み、
 * 下に件数を置く（設計ボード ST08）。並び替えは行ごとの「…」（BacklogRowMenu）が持つ —
 * 選んで開く帯や、開くための別の面は持たない。
 *
 * 表は CSS グリッドで組む。`<table>` にしないのは、領域が狭いときに列を捨ててカードに
 * 組み替えるため（表の要素は列の構造を捨てられない）。役割（table / row / cell）は
 * 付けておき、読み上げでは表として辿れるようにする。
 *
 * 文字の大きさと空きは報道系サイトの記事面の一覧に寄せる。題名は 15px の太字、補足は 13px。見出し行は
 * 白い地に下の線だけにし、灰色の地はスプリントの段の帯にだけ使う（灰色の帯が 2 段重ならないように）。
 *
 * 表かカードかは一覧の領域の幅で決める（useContainerNarrowerThan。境目をまたいだときだけ描き直す）。
 * 測れない環境では表。
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
  busyId,
  nameOf,
  onCreate,
  onChangeStatus,
  onMoveUp,
  onMoveDown,
  onMoveLast,
  onMoveToSprint,
  onRemoveFromSprint,
  outcomeOf,
  onVerify,
  renderGroupAction,
  footerAction,
  onRetry,
}: BacklogListProps) {
  // 畳んだ段だけを覚える。既定は開いた状態なので、スプリントが増えても勝手に隠れない。
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  // 期限超過の判定に使う「今日」。行ごとに Date を作らず、日付が変わったときだけ変わる値を全行へ渡す
  // （描いている途中で new Date() から求めると、コンパイラが 1 回しか求めず日付をまたげない）。
  const today = useLocalToday();
  // 読み込み中・0 件・失敗のときは一覧の器を描かないので、器が付いた・作り直されたときに
  // 測り直せるよう callback ref で受ける。
  const [containerRef, narrow] = useContainerNarrowerThan<HTMLDivElement>(BACKLOG_TABLE_MIN_WIDTH);
  const layout: BacklogRowLayout = narrow === true ? 'card' : 'table';
  // 一覧の取得・作成で groups が変わっても、スプリントの選択肢が同じなら各行へ
  // 同じ配列を渡す。毎回 filter/map すると memo の行をすべて描き直してしまう。
  const sprintOptionsKey = JSON.stringify(groups.filter((group) => group.kind === 'sprint').map(({ id, name }) => [id, name]));
  const { sprintOptions, otherSprintsById } = useMemo(() => {
    const options = (JSON.parse(sprintOptionsKey) as [string, string][]).map(([id, name]) => ({ id, name }));
    return {
      sprintOptions: options,
      otherSprintsById: new Map(options.map(({ id }) => [id, options.filter((sprint) => sprint.id !== id)])),
    };
  }, [sprintOptionsKey]);

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
  // 並び替えの「…」はアーカイブでは出さない（アーカイブ済みの並びに意味は無い）。
  const canReorder = !archived;
  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div role="table" aria-label="チケット" aria-rowcount={total} aria-busy={loading || undefined} data-layout={layout}>
          {/* 見出し行。カードのときは列を捨てるので出さない（各カードが項目名を持つ）。 */}
          {layout === 'table' && (
            <div
              role="row"
              className={`sticky top-0 z-10 border-b border-surface-3 bg-surface-1 px-3 text-[13px] font-medium text-[var(--color-text-muted)] sm:px-4 ${BACKLOG_TABLE_GRID}`}
            >
              {COLUMNS.map((label) => (
                <div key={label} role="columnheader" className="whitespace-nowrap py-3">
                  {label === '操作' ? <span className="sr-only">{label}</span> : label}
                </div>
              ))}
            </div>
          )}

          {groups.map((group) => {
            // 入れ先に選べるスプリント（いま入っている段は除く）。段の中では同じ配列でよい。
            const otherSprints = otherSprintsById.get(group.id) ?? sprintOptions;
            return (
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
                    <div role="cell" aria-colspan={7} className="px-3 py-6 text-center text-[13px] leading-[1.7] text-[var(--color-text-muted)]">
                      {group.kind === 'sprint'
                        ? 'このスプリントにはまだ何も入っていません。バックログの行の「…」から入れられます。'
                        : 'すべてスプリントに入っています。'}
                    </div>
                  </div>
                ) : (
                  group.tickets.map((ticket, index) => (
                    <BacklogRow
                      key={ticket.id}
                      ticket={ticket}
                      projectKey={projectKey}
                      type={typeOf(ticket.typeId)}
                      status={statusOf(ticket.statusId)}
                      statuses={statuses}
                      assigneeName={nameOf(ticket.assigneePrincipalId)}
                      busy={ticket.id === busyId}
                      canEdit={canEdit && !archived}
                      canReorder={canReorder}
                      indented={ticket.parentId !== null}
                      today={today}
                      layout={layout}
                      isFirst={index === 0}
                      isLast={index === group.tickets.length - 1}
                      inSprint={group.kind === 'sprint'}
                      otherSprints={otherSprints}
                      onChangeStatus={onChangeStatus}
                      onMoveUp={onMoveUp}
                      onMoveDown={onMoveDown}
                      onMoveLast={onMoveLast}
                      onMoveToSprint={onMoveToSprint}
                      onRemoveFromSprint={onRemoveFromSprint}
                      outcome={outcomeOf?.(ticket.id) ?? null}
                      onVerify={onVerify}
                    />
                  ))
                )}
                {group.kind === 'backlog' && canEdit && !archived && <TicketCreateRow onCreate={onCreate} />}
              </BacklogGroup>
            );
          })}
        </div>

        {/*
          件数は status で読み上げに通知する（条件を変えたら「何件になったか」が耳でも分かる）。
          取り直し中は古い一覧を出したまま「更新中」を添える —— 消して読み込み表示にすると、
          押した行がその瞬間だけ消えて選び直すことになる。
        */}
        <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-4 sm:px-4">
          <p role="status" aria-live="polite" className="text-[13px] tabular-nums text-[var(--color-text-muted)]">
            {total} 件の課題を表示{showTotal && <>・全 {totalCount} 件</>}
            {loading && <span className="ml-2">更新中…</span>}
          </p>
          {footerAction}
        </div>
      </div>
    </div>
  );
}
