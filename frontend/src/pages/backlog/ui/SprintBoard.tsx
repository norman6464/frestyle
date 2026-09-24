import { useState } from 'react';
import { ConfirmModal, EmptyState, Loading, FsIcon, NameCreateForm, fsIcon } from '@/shared/ui';
import type { Ticket } from '@/entities/ticket';
import { useSprints } from '../model/useSprints';
import { useSprintTickets } from '../model/useSprintTickets';
import SprintCard from './SprintCard';
import { sprintConfirmText, type SprintConfirmKind } from '../lib/sprintConfirm';

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
  // 取り消せない操作（削除・完了）は確認を挟む。
  const [confirming, setConfirming] = useState<{ kind: SprintConfirmKind; sprintId: string; name: string; count: number } | null>(null);
  const [confirmPending, setConfirmPending] = useState(false);

  // 失敗は投げ直す。NameCreateForm は投げられたときだけ入力を残す（打ち直しにさせない）。
  const handleCreate = async ({ name }: { name: string }) => {
    try {
      await create({ name });
    } catch (cause) {
      onError('スプリントを作成できませんでした。');
      throw cause;
    }
    setCreating(false);
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

  const runConfirmed = async () => {
    if (!confirming) return;
    setConfirmPending(true);
    try {
      if (confirming.kind === 'delete') {
        await remove(confirming.sprintId).catch(() => onError('スプリントを削除できませんでした。'));
      } else {
        await handleChangeState(confirming.sprintId, 'completed');
      }
    } finally {
      setConfirmPending(false);
      setConfirming(null);
    }
  };

  const confirmText = confirming ? sprintConfirmText(confirming.kind, confirming.name, confirming.count) : null;

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
        <div className="mb-3 flex max-w-xl items-center gap-2">
          {creating ? (
            <NameCreateForm
              what="スプリント"
              layout="inline"
              initialName={`スプリント ${sprints.length + 1}`}
              onCreate={handleCreate}
              onCancel={() => setCreating(false)}
              autoFocus
            />
          ) : (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex items-center gap-1.5 rounded-lg border border-surface-3 bg-surface-1 px-3 py-1.5 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
            >
              <FsIcon name="plus" className="h-4 w-4" />
              スプリントを作成
            </button>
          )}
        </div>
      )}

      {sprints.length === 0 ? (
        <EmptyState
          icon={fsIcon('calendar')}
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
            onChangeState={(state) => {
              if (state === 'completed') {
                setConfirming({ kind: 'complete', sprintId: sprint.id, name: sprint.name, count: (bySprint[sprint.id] ?? []).length });
                return;
              }
              void handleChangeState(sprint.id, state);
            }}
            onUpdate={(input) => void update(sprint.id, input).catch(() => onError('スプリントを保存できませんでした。'))}
            onDelete={() =>
              setConfirming({ kind: 'delete', sprintId: sprint.id, name: sprint.name, count: (bySprint[sprint.id] ?? []).length })
            }
          />
        ))
      )}

      <ConfirmModal
        isOpen={confirming !== null}
        title={confirmText?.title}
        message={confirmText?.message ?? ''}
        confirmText={confirmText?.confirmText}
        isDanger
        icon={confirming?.kind === 'delete' ? 'trash' : undefined}
        pending={confirmPending}
        onConfirm={() => void runConfirmed()}
        onCancel={() => setConfirming(null)}
      />
    </div>
  );
}
