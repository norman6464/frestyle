import { useState } from 'react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { EmptyState, Loading } from '@/shared/ui';
import { CalendarDaysIcon } from '@heroicons/react/24/outline';
import type { Ticket } from '@/entities/ticket';
import { useSprints } from '../model/useSprints';
import { useSprintTickets } from '../model/useSprintTickets';
import SprintCard from './SprintCard';

export interface SprintBoardProps {
  /** ページが持つスプリントの状態（チケットの面の「入れ先」と同じものを使う）。 */
  sprints: ReturnType<typeof useSprints>;
  workspaceSlug: string | undefined;
  canEdit: boolean;
  /** 表示キーの接頭辞（FRESTYLE-12 の FRESTYLE）。 */
  projectKey: string;
  /**
   * バックログ一覧のチケット（既に全項目が入っている）。スプリントの中身は ID だけを引き、
   * 題名などはここから引き当てる（同じ値を 2 経路で取らない）。
   */
  tickets: Ticket[];
  /** 失敗をトーストで知らせる（規則違反は backend が 409 で返すので、文言をここで作る）。 */
  onError: (message: string) => void;
}

/**
 * SprintBoard はプロジェクトのスプリントを縦に並べる面。
 *
 * バックログ（順番に積んだ待ち行列）とは別のタブにしてある。同じ画面に両方を出すと、
 * 「いま何を順に消化するか」と「いつやるかの区切り」という別の問いが 1 画面に混ざる。
 */
export default function SprintBoard({
  sprints: sprintState,
  workspaceSlug,
  canEdit,
  projectKey,
  tickets,
  onError,
}: SprintBoardProps) {
  const { sprints, loading, error, busyId, create, update, changeState, remove, removeTicket, moveTicket } =
    sprintState;
  const { bySprint, reload: reloadMembership } = useSprintTickets(
    workspaceSlug,
    sprints.map((s) => s.id),
  );
  const byId = new Map(tickets.map((t) => [t.id, t]));
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');

  const handleCreate = async () => {
    const name = newName.trim();
    if (name === '') return;
    try {
      await create({ name });
      setNewName('');
      setCreating(false);
    } catch {
      onError('スプリントを作成できませんでした。');
    }
  };

  // 規則違反は backend が 409 で返す。どの規則に当たったかを文言で伝える。
  const handleChangeState = async (sprintId: string, state: 'active' | 'completed') => {
    try {
      await changeState(sprintId, state);
    } catch (e) {
      const code = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'active_sprint_exists') {
        onError('進行中のスプリントが既にあります。先に完了してください。');
        return;
      }
      onError(state === 'active' ? 'スプリントを開始できませんでした。' : 'スプリントを完了できませんでした。');
    }
  };

  if (loading) return <Loading className="py-16" />;

  if (error) {
    return (
      <p role="alert" className="px-4 py-6 text-sm text-danger-ink">
        {error}
      </p>
    );
  }

  return (
    <div className="p-4">
      {canEdit && (
        <div className="mb-3 flex items-center gap-2">
          {creating ? (
            <>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="スプリントの名前"
                aria-label="スプリントの名前"
                autoFocus
                className="rounded-md border border-surface-3 px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void handleCreate()}
                disabled={newName.trim() === ''}
                className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-50"
              >
                作成
              </button>
              <button
                type="button"
                onClick={() => {
                  setCreating(false);
                  setNewName('');
                }}
                className="rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
              >
                キャンセル
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg border border-surface-3 bg-surface-1 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
            >
              <PlusIcon className="h-4 w-4" aria-hidden="true" />
              スプリントを作成
            </button>
          )}
        </div>
      )}

      {sprints.length === 0 ? (
        <EmptyState
          icon={CalendarDaysIcon}
          title="スプリントがありません"
          description="「いつやるか」で仕事を区切るとき、ここにスプリントを作ります。"
        />
      ) : (
        sprints.map((sprint) => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            canEdit={canEdit}
            busy={busyId === sprint.id}
            projectKey={projectKey}
            tickets={(bySprint[sprint.id] ?? []).map((id) => byId.get(id)).filter((t): t is Ticket => t !== undefined)}
            onRemoveTicket={(ticketId) =>
              void removeTicket(ticketId)
                .then(reloadMembership)
                .catch(() => onError('スプリントから外せませんでした。'))
            }
            onMoveTicket={(ticketId, anchorTicketId, anchorAfter) =>
              void moveTicket(ticketId, anchorTicketId, anchorAfter)
                .then(reloadMembership)
                .catch(() => onError('並べ替えられませんでした。'))
            }
            onChangeState={(state) => void handleChangeState(sprint.id, state)}
            onUpdate={(input) => void update(sprint.id, input).catch(() => onError('スプリントを保存できませんでした。'))}
            onDelete={() => void remove(sprint.id).catch(() => onError('スプリントを削除できませんでした。'))}
          />
        ))
      )}
    </div>
  );
}
