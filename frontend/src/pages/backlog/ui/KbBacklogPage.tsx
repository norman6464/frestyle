import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowTopRightOnSquareIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { BacklogSidebar } from '@/widgets/backlog-sidebar';
import { SecondaryPanel } from '@/widgets/secondary-panel';
import { SidebarSection } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';
import { getApiError } from '@/shared/lib/classifyApiError';
import { TicketRepository } from '@/entities/ticket';
import type { SprintState } from '@/entities/sprint';
import { useTicketList } from '../model/useTicketList';
import { useTicketMasters } from '../model/useTicketMasters';
import { useTicketLabels } from '../model/useTicketLabels';
import { usePrincipalNames } from '../model/usePrincipalNames';
import { useBacklogProject } from '../model/useBacklogProject';
import { useBacklogUrlState } from '../model/useBacklogUrlState';
import BacklogFilterBar from './BacklogFilterBar';
import BacklogList, { BACKLOG_GROUP_ID, type BacklogGroupModel } from './BacklogList';
import BacklogTabs from './BacklogTabs';
import SprintBoard from './SprintBoard';
import { backlogPath, type BacklogView } from '../model/backlogView';
import { useSprints } from '../model/useSprints';
import { useSprintTickets } from '../model/useSprintTickets';
import TicketDetailPanel from './TicketDetailPanel';
import TicketStatusAdmin from './TicketStatusAdmin';
import TicketTypeAdmin from './TicketTypeAdmin';

export interface KbBacklogPageProps {
  /** どの面か。経路が決める（/backlog/:projectId・/settings・/archive）。 */
  view?: BacklogView;
}

/**
 * KbBacklogPage はバックログ画面の container（設計 0・Ⅲ・Ⅵ）。
 *
 * 面（バックログ / 状態と種別 / アーカイブ）は本文のタブ列が持ち、1 つずつが固有の URL を
 * 持つ。スプリントは別の面にせず、本文の段としてバックログの上に積む（見本と同じ）。
 */
export default function KbBacklogPage({ view = 'backlog' }: KbBacklogPageProps) {
  const { projectId } = useParams<{ projectId?: string }>();
  const archived = view === 'archive';
  const navigate = useNavigate();
  const { showToast } = useToast();

  // 面・アーカイブの切り替え・選択中のチケットは URL に持つ。チケットを開いて戻ったときに
  // 絞り込みと選択が残るようにするため（useBacklogUrlState）。
  const {
    selectedId,
    statusId,
    typeId,
    labelId,
    unassigned,
    assignedToMe,
    overdue,
    q,
    selectTicket,
    setStatusId,
    setTypeId,
    setLabelId,
    setAssignedToMe,
    setQuery,
    reset,
  } = useBacklogUrlState();
  const [detailMobileOpen, setDetailMobileOpen] = useState(false);
  const [enabling, setEnabling] = useState(false);

  const {
    workspaceSlug,
    project,
    noProjects,
    loading: projectLoading,
    error: projectError,
  } = useBacklogProject(projectId, (id) => navigate(backlogPath(id, view), { replace: true }));

  const list = useTicketList(workspaceSlug ?? undefined, project?.id, {
    archived,
    statusId: statusId ?? undefined,
    typeId: typeId ?? undefined,
    labelId: labelId ?? undefined,
    unassigned,
    assignedToMe,
    overdue,
    q: q || undefined,
  });
  const masters = useTicketMasters(workspaceSlug ?? undefined, project?.id);
  const labels = useTicketLabels(workspaceSlug ?? undefined);
  // スプリントは「チケット」の面（入れ先の選択）と「スプリント」の面の両方が要るので、
  // ページで 1 つ持って両方へ渡す（同じ一覧を 2 回取らない）。
  const sprints = useSprints(workspaceSlug ?? undefined, project?.id);
  // どのチケットがどのスプリントに入っているかは ID だけ引き、中身は一覧の応答から引き当てる。
  const openSprints = sprints.sprints.filter((sprint) => sprint.state !== 'completed');
  const { bySprint } = useSprintTickets(
    workspaceSlug ?? undefined,
    openSprints.map((sprint) => sprint.id),
  );
  const { principals, nameOf, initialsOf } = usePrincipalNames(workspaceSlug ?? undefined);

  /**
   * 一覧を段に割る。1 件のチケットはどこか 1 つの段にしか出さない —— 見本と同じく、
   * スプリントに入っているものはその段に、残りが「バックログ」。両方に出すと、
   * 同じ行を 2 回捌くことになる。
   */
  const groups: BacklogGroupModel[] = useMemo(() => {
    const byId = new Map(list.tickets.map((ticket) => [ticket.id, ticket]));
    const taken = new Set<string>();
    const sprintGroups: BacklogGroupModel[] = openSprints.map((sprint) => {
      const tickets = (bySprint[sprint.id] ?? [])
        .map((id) => byId.get(id))
        .filter((ticket): ticket is NonNullable<typeof ticket> => ticket !== undefined);
      for (const ticket of tickets) taken.add(ticket.id);
      const period = [sprint.startDate, sprint.endDate].filter(Boolean).join(' – ');
      return {
        id: sprint.id,
        kind: 'sprint' as const,
        name: sprint.name,
        tickets,
        sprintState: sprint.state,
        note: period || undefined,
      };
    });
    return [
      ...sprintGroups,
      {
        id: BACKLOG_GROUP_ID,
        kind: 'backlog' as const,
        name: 'バックログ',
        tickets: list.tickets.filter((ticket) => !taken.has(ticket.id)),
      },
    ];
    // openSprints は毎回新しい配列になるので、中身の署名で見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.tickets, bySprint, openSprints.map((s) => `${s.id}:${s.name}:${s.state}`).join(',')]);

  // プロジェクトを切り替えたら文脈を捨てる（前のプロジェクトのチケットを次の画面で引きずらない）。
  // 初回の読み込みでは捨てない — URL に載っている選択や絞り込みを開いた直後に消してしまう。
  const shownProject = useRef<string | null>(null);
  useEffect(() => {
    const id = project?.id ?? null;
    if (shownProject.current !== null && shownProject.current !== id) reset();
    shownProject.current = id;
  }, [project?.id, reset]);

  const enabled = !masters.loading && !masters.error && masters.statuses.length > 0;
  const selectedTicket = selectedId ? list.tickets.find((t) => t.id === selectedId) ?? null : null;
  const parentTicket = selectedTicket?.parentId
    ? list.tickets.find((t) => t.id === selectedTicket.parentId)
    : undefined;

  const handleEnable = async () => {
    if (!workspaceSlug || !project) return;
    setEnabling(true);
    try {
      await TicketRepository.enable(workspaceSlug, project.id);
      masters.refresh();
      list.refresh();
    } catch {
      showToast('error', 'チケットを有効化できませんでした。');
    } finally {
      setEnabling(false);
    }
  };

  const handleSelect = (ticketId: string) => {
    selectTicket(ticketId);
    setDetailMobileOpen(true);
  };

  /** 段の見出しから作る。名前は連番の既定を置くだけにして、変更は「状態と種別」側へ寄せない。 */
  const handleCreateSprint = async () => {
    const name = window.prompt('スプリントの名前', `スプリント ${sprints.sprints.length + 1}`);
    if (name === null || name.trim() === '') return;
    try {
      await sprints.create({ name: name.trim() });
    } catch {
      showToast('error', 'スプリントを作成できませんでした。');
    }
  };

  /**
   * 開始・完了の切り替え。規則違反は backend が 409 で返すので、どの規則に当たったかを
   * 文言にする（進行中は 1 本まで）。
   */
  const handleChangeSprintState = async (sprintId: string, current: SprintState | undefined) => {
    const next: SprintState = current === 'active' ? 'completed' : 'active';
    try {
      await sprints.changeState(sprintId, next);
      list.refresh();
    } catch (cause) {
      const code = (cause as { response?: { data?: { error?: string } } })?.response?.data?.error;
      if (code === 'active_sprint_exists') {
        showToast('error', '進行中のスプリントが既にあります。先に完了してください。');
        return;
      }
      showToast('error', next === 'active' ? 'スプリントを開始できませんでした。' : 'スプリントを完了できませんでした。');
    }
  };

  const withToastOnFailure = async (action: () => Promise<unknown>, failureMessage: string) => {
    try {
      await action();
    } catch (cause) {
      showToast('error', getApiError(cause).status === 403 ? 'この操作を行う権限がありません。' : failureMessage);
      throw cause;
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* 柱の中の「バックログの区画」。プロジェクトの切替と絞り込みだけを持つ
          （面の切替とスプリントは本文のタブ列と段が持つ）。柱そのものは AppShell が描く。 */}
      <SidebarSection>
        <BacklogSidebar workspaceSlug={workspaceSlug ?? undefined} project={project} />
      </SidebarSection>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {projectError ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-text-muted)]">
            {projectError}
          </div>
        ) : noProjects ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <p className="mb-1 text-base font-semibold text-[var(--color-text-secondary)]">
                プロジェクトがありません
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                プロジェクトを作るとバックログを使えるようになります。
              </p>
            </div>
          </div>
        ) : projectLoading || !project ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
            読み込み中…
          </div>
        ) : (
          <>
            {/* プロジェクトの見出し。その下に面のタブ列を置く（見本と同じ並び）。 */}
            <div className="border-b border-surface-3">
              <div className="flex items-center gap-2 px-4 pb-1.5 pt-3">
                <h1 className="truncate text-lg font-semibold text-[var(--color-text-primary)]">{project.name}</h1>
                <span className="shrink-0 text-xs text-[var(--color-text-muted)]">
                  プロジェクト・{project.key.toUpperCase()}
                </span>
                {view === 'backlog' && enabled && (
                  <button
                    type="button"
                    onClick={() =>
                      void withToastOnFailure(
                        () => list.createTicket({ title: '無題のチケット' }).then((t) => handleSelect(t.id)),
                        'チケットを作成できませんでした。',
                      )
                    }
                    className="ml-auto shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                  >
                    チケットを作成
                  </button>
                )}
                {view === 'backlog' && !enabled && !masters.loading && (
                  <button
                    type="button"
                    onClick={() => void handleEnable()}
                    disabled={enabling}
                    className="ml-auto shrink-0 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                  >
                    {enabling ? '有効化中…' : 'チケットを有効化'}
                  </button>
                )}
              </div>
              <BacklogTabs projectId={project.id} current={view} />
            </div>

            {view !== 'settings' && enabled && (
              <BacklogFilterBar
                statuses={masters.statuses}
                types={masters.types}
                labels={labels.labels}
                statusId={statusId}
                typeId={typeId}
                labelId={labelId}
                assignedToMe={assignedToMe}
                q={q}
                onChangeStatusId={setStatusId}
                onChangeTypeId={setTypeId}
                onChangeLabelId={setLabelId}
                onToggleAssignedToMe={setAssignedToMe}
                onChangeQuery={setQuery}
              />
            )}

            <div className="min-h-0 flex-1">
              {view !== 'settings' &&
                (!enabled && !masters.loading ? (
                  <div className="flex h-full items-center justify-center px-6 text-center">
                    <div>
                      <p className="mb-1 text-base font-semibold text-[var(--color-text-secondary)]">
                        このプロジェクトではチケットを使っていません
                      </p>
                      <p className="text-sm text-[var(--color-text-muted)]">
                        有効化すると、状態 5 件と種別 3 件の雛形が入ります。あとから増やせます。
                      </p>
                    </div>
                  </div>
                ) : (
                  <BacklogList
                    groups={groups}
                    statuses={masters.statuses}
                    types={masters.types}
                    projectKey={project.key}
                    loading={list.loading}
                    error={list.error}
                    archived={archived}
                    canEdit
                    selectedId={selectedId}
                    busyId={list.busyId}
                    nameOf={nameOf}
                    initialsOf={initialsOf}
                    onSelect={handleSelect}
                    onCreate={(title) => list.createTicket({ title }).then((t) => handleSelect(t.id))}
                    onChangeStatus={(ticketId, nextStatusId) => {
                      void withToastOnFailure(
                        () => list.changeStatus(ticketId, { statusId: nextStatusId }),
                        '状態を変えられませんでした。',
                      ).catch(() => undefined);
                    }}
                    onMove={(id, input) => list.move(id, input)}
                    onMoveInSprint={(ticketId, anchorTicketId, anchorAfter) =>
                      sprints
                        .moveTicket(ticketId, anchorTicketId, anchorAfter)
                        .then(() => list.refresh())
                        .catch(() => showToast('error', 'スプリントの中で動かせませんでした。'))
                    }
                    onMoveToSprint={(ticketId, sprintId) =>
                      void sprints
                        .addTicket(sprintId, ticketId)
                        .catch(() => showToast('error', 'スプリントへ入れられませんでした。'))
                    }
                    onRemoveFromSprint={(ticketId) =>
                      void sprints
                        .removeTicket(ticketId)
                        .catch(() => showToast('error', 'スプリントから出せませんでした。'))
                    }
                    renderGroupAction={(group) =>
                      group.kind === 'sprint' ? (
                        <button
                          type="button"
                          disabled={sprints.busyId === group.id}
                          onClick={() => void handleChangeSprintState(group.id, group.sprintState)}
                          className="rounded border border-surface-3 px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-surface-1 disabled:opacity-50"
                        >
                          {group.sprintState === 'active' ? 'スプリントを完了' : 'スプリントを開始'}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleCreateSprint()}
                          className="rounded border border-surface-3 px-2 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-surface-1"
                        >
                          スプリントを作成
                        </button>
                      )
                    }
                    onRetry={list.refresh}
                  />
                ))}

              {/* 見出しは h1（プロジェクト名）→ h2（節）の順に落とす。節の名前を付けないと
                  管理の面が 3 つ続けて並ぶだけになり、中の EmptyState の h3 まで段が飛ぶ。 */}
              {view === 'settings' && (
                <div className="h-full space-y-8 overflow-y-auto p-4">
                  <section>
                    <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">状態</h2>
                    <TicketStatusAdmin
                      statuses={masters.statuses}
                      onCreate={masters.createStatus}
                      onSetInitial={masters.setInitialStatus}
                      onArchive={masters.archiveStatus}
                    />
                  </section>
                  <section>
                    <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">種別</h2>
                    <TicketTypeAdmin
                      types={masters.types}
                      onCreate={masters.createType}
                      onSetDefault={masters.setDefaultType}
                      onArchive={masters.archiveType}
                    />
                  </section>
                  <section>
                    <h2 className="mb-2 text-sm font-semibold text-[var(--color-text-primary)]">スプリント</h2>
                    {/* 改名・期間・削除はここ。バックログの面では「作る・開始する・完了する・
                        中身を入れ替える」だけを段の見出しで受ける。 */}
                    <SprintBoard
                      sprints={sprints}
                      canEdit
                      workspaceSlug={workspaceSlug ?? undefined}
                      projectKey={project.key}
                      tickets={list.tickets}
                      onError={(message) => showToast('error', message)}
                    />
                  </section>
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {view !== 'settings' && selectedTicket && (
        <SecondaryPanel
          title="チケット"
          side="right"
          resizable
          resizeStorageKey="frestyle.panel.ticket-detail.width"
          defaultWidth={420}
          mobileOpen={detailMobileOpen}
          onMobileClose={() => setDetailMobileOpen(false)}
          headerActions={
            <div className="flex shrink-0 items-center gap-1.5">
              <Link
                to={`/tickets/${selectedTicket.id}`}
                aria-label="全画面で開く"
                title="全画面で開く"
                className="rounded-md border border-surface-3 p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => selectTicket(null)}
                aria-label="詳細を閉じる"
                title="詳細を閉じる"
                className="rounded-md border border-surface-3 p-1.5 text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2"
              >
                <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          }
        >
          <TicketDetailPanel
            key={selectedTicket.id}
            ticket={selectedTicket}
            projectKey={project?.key ?? ''}
            workspaceSlug={workspaceSlug ?? ''}
            statuses={masters.statuses}
            types={masters.types}
            principals={principals}
            parentTicket={parentTicket}
            canEdit
            busy={list.busyId === selectedTicket.id}
            allLabels={labels.labels}
            onUpdate={(ticketId, input) => list.updateTicket(ticketId, input)}
            onChangeStatus={(statusId) =>
              withToastOnFailure(() => list.changeStatus(selectedTicket.id, { statusId }), '状態を変更できませんでした。')
            }
            onAssign={(principalId) =>
              withToastOnFailure(() => list.assign(selectedTicket.id, principalId), '担当を設定できませんでした。')
            }
            onUnassign={() => withToastOnFailure(() => list.unassign(selectedTicket.id), '担当を外せませんでした。')}
            onArchive={() =>
              withToastOnFailure(() => list.archiveTicket(selectedTicket.id), 'アーカイブできませんでした。').then(() =>
                selectTicket(null),
              )
            }
            onRestore={() =>
              withToastOnFailure(() => list.restoreTicket(selectedTicket.id), '現役に戻せませんでした。').then(() =>
                selectTicket(null),
              )
            }
            onToggleLabel={(label) => {
              const attached = selectedTicket.labels.some((l) => l.id === label.id);
              void withToastOnFailure(
                () =>
                  attached
                    ? list.removeLabel(selectedTicket.id, label.id)
                    : list.addLabel(selectedTicket.id, label),
                attached ? 'ラベルを外せませんでした。' : 'ラベルを付けられませんでした。',
              );
            }}
            onCreateLabel={(name, color) => labels.createLabel({ name, color })}
            onChangeParent={async (parentId) => {
              try {
                await list.changeParent(selectedTicket.id, parentId);
              } catch (cause) {
                const info = getApiError(cause);
                showToast(
                  'error',
                  info.status === 403
                    ? 'この操作を行う権限がありません。'
                    : info.serverCode === 'ticket_hierarchy_rejected'
                      ? 'その親には移せません（循環になる、または階層の深さの上限を超えます）。'
                      : '親を変更できませんでした。',
                );
              }
            }}
          />
        </SecondaryPanel>
      )}
    </div>
  );
}
