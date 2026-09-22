import { useState } from 'react';
import { ExclamationCircleIcon, InboxIcon } from '@heroicons/react/24/outline';
import type { Ticket, TicketStatus, TicketType } from '@/entities/ticket';
import type { SprintState } from '@/entities/sprint';
import EmptyState from '@/shared/ui/EmptyState';
import Loading from '@/shared/ui/Loading';
import BacklogRow from './BacklogRow';
import BacklogGroup from './BacklogGroup';
import BacklogReorderBar from './BacklogReorderBar';
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

export interface BacklogListProps {
  groups: BacklogGroupModel[];
  statuses: TicketStatus[];
  types: TicketType[];
  projectKey: string;
  loading: boolean;
  error: string | null;
  archived: boolean;
  filtered?: boolean;
  canEdit: boolean;
  selectedId: string | null;
  busyId: string | null;
  nameOf: (principalId: string | null) => string;
  initialsOf: (principalId: string | null) => string;
  onSelect: (ticketId: string) => void;
  onCreate: (title: string) => Promise<void>;
  onChangeStatus: (ticketId: string, statusId: string) => void;
  /** バックログの段の中で 1 つ動かす。 */
  onMove: (ticketId: string, input: { anchorTicketId?: string; anchorAfter?: boolean }) => Promise<void>;
  /** スプリントの段の中で 1 つ動かす（並びはスプリントごとに別に持つ）。 */
  onMoveInSprint?: (ticketId: string, anchorTicketId: string, anchorAfter: boolean) => Promise<void>;
  /** 選択中のチケットをスプリントへ入れる。 */
  onMoveToSprint?: (ticketId: string, sprintId: string) => void;
  /** 選択中のチケットをスプリントから出す（バックログへ戻る）。 */
  onRemoveFromSprint?: (ticketId: string) => void;
  /** 段の見出しの右に出す操作（スプリントを開始 / 完了 / 作成）。段ごとに作る。 */
  renderGroupAction?: (group: BacklogGroupModel) => React.ReactNode;
  onRetry: () => void;
}

/** バックログの本文（スプリントの段 → バックログの段 → 並び替えの帯）。見本 2a。 */
export default function BacklogList({
  groups,
  statuses,
  types,
  projectKey,
  loading,
  error,
  archived,
  filtered = false,
  canEdit,
  selectedId,
  busyId,
  nameOf,
  initialsOf,
  onSelect,
  onCreate,
  onChangeStatus,
  onMove,
  onMoveInSprint,
  onMoveToSprint,
  onRemoveFromSprint,
  renderGroupAction,
  onRetry,
}: BacklogListProps) {
  // 畳んだ段だけを覚える。既定は開いた状態なので、スプリントが増えても勝手に隠れない。
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  if (error) {
    return (
      <EmptyState
        icon={ExclamationCircleIcon}
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
        icon={InboxIcon}
        title={filtered ? '条件に合うチケットはありません' : archived ? 'アーカイブされたチケットはありません' : 'まだチケットがありません'}
        description={filtered ? '上の絞り込み条件を変更するか、解除して確認してください。' : archived ? 'アーカイブしたチケットはここに保管されます。必要なときに戻せます。' : 'まずは、取り組みたい作業を1つ書いてみましょう。詳しい内容はあとから追加できます。'}
      />
      {!archived && !filtered && canEdit && <TicketCreateRow onCreate={onCreate} />}
      </div>
    );
  }

  const statusOf = (id: string) => statuses.find((s) => s.id === id);
  const typeOf = (id: string) => types.find((t) => t.id === id);

  // 並び替えは「選んだ行が入っている段の中」で行う。段をまたぐ移動は別の操作
  // （スプリントへ入れる／から出す）なので、上下のボタンには載せない。
  const ownerGroup = selectedId ? groups.find((g) => g.tickets.some((t) => t.id === selectedId)) ?? null : null;
  const siblings = ownerGroup?.tickets ?? [];
  const selectedIndex = selectedId ? siblings.findIndex((t) => t.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? siblings[selectedIndex] : null;

  const moveWithin = (anchor: Ticket, after: boolean) => {
    if (!selected || !ownerGroup) return;
    if (ownerGroup.kind === 'sprint') {
      void onMoveInSprint?.(selected.id, anchor.id, after);
      return;
    }
    void onMove(selected.id, { anchorTicketId: anchor.id, anchorAfter: after });
  };

  const handleMoveUp = () => {
    if (selectedIndex <= 0) return;
    moveWithin(siblings[selectedIndex - 1], false);
  };
  const handleMoveDown = () => {
    if (selectedIndex < 0 || selectedIndex >= siblings.length - 1) return;
    moveWithin(siblings[selectedIndex + 1], true);
  };
  const handleMoveLast = () => {
    if (!selected || !ownerGroup) return;
    if (ownerGroup.kind === 'sprint') {
      if (siblings.length < 2) return;
      void onMoveInSprint?.(selected.id, siblings[siblings.length - 1].id, true);
      return;
    }
    void onMove(selected.id, {});
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
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
              <p className="px-3 py-4 text-center text-xs text-[var(--color-text-muted)]">
                {group.kind === 'sprint'
                  ? 'このスプリントにはまだ何も入っていません。下の一覧から選んで「スプリントへ」で入れます。'
                  : 'すべてスプリントに入っています。'}
              </p>
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
                  assigneeInitials={initialsOf(ticket.assigneePrincipalId)}
                  selected={ticket.id === selectedId}
                  busy={ticket.id === busyId}
                  canEdit={canEdit && !archived}
                  indented={ticket.parentId !== null}
                  onOpen={() => onSelect(ticket.id)}
                  onChangeStatus={(statusId) => onChangeStatus(ticket.id, statusId)}
                />
              ))
            )}
            {group.kind === 'backlog' && canEdit && !archived && <TicketCreateRow onCreate={onCreate} />}
          </BacklogGroup>
        ))}
      </div>

      {canEdit && !archived && (
        <BacklogReorderBar
          selectedKey={selected ? `${projectKey.toUpperCase()}-${selected.number}` : null}
          groupName={ownerGroup?.name ?? null}
          isFirst={selectedIndex <= 0}
          isLast={selectedIndex < 0 || selectedIndex >= siblings.length - 1}
          onMoveUp={handleMoveUp}
          onMoveDown={handleMoveDown}
          onMoveLast={handleMoveLast}
          sprints={groups
            .filter((g) => g.kind === 'sprint' && g.id !== ownerGroup?.id)
            .map((g) => ({ id: g.id, name: g.name }))}
          onMoveToSprint={selected && onMoveToSprint ? (sprintId) => onMoveToSprint(selected.id, sprintId) : undefined}
          onRemoveFromSprint={
            selected && ownerGroup?.kind === 'sprint' && onRemoveFromSprint
              ? () => onRemoveFromSprint(selected.id)
              : undefined
          }
        />
      )}
    </div>
  );
}
