import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowTopRightOnSquareIcon, ExclamationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { BacklogSidebar, useBacklogFilterCounts } from '@/widgets/backlog-sidebar';
import { SecondaryPanel } from '@/widgets/secondary-panel';
import { EmptyState, Loading, SidebarSection } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';
import { getApiError } from '@/shared/lib/classifyApiError';
import { TicketRepository, formatTicketKey } from '@/entities/ticket';
import type { SprintState } from '@/entities/sprint';
import { useTicketList } from '../model/useTicketList';
import { useTicketMasters } from '../model/useTicketMasters';
import { useTicketLabels } from '../model/useTicketLabels';
import { usePrincipalNames } from '../model/usePrincipalNames';
import { useBacklogProject } from '../model/useBacklogProject';
import { useBacklogUrlState } from '../model/useBacklogUrlState';
import BacklogFilterBar from './BacklogFilterBar';
import BacklogQuickFilters from './BacklogQuickFilters';
import BacklogList, { BACKLOG_GROUP_ID, type BacklogGroupModel } from './BacklogList';
import BacklogTabs from './BacklogTabs';
import SprintBoard from './SprintBoard';
import { backlogPath, type BacklogView } from '../model/backlogView';
import { useSprints } from '../model/useSprints';
import { useSprintTickets } from '../model/useSprintTickets';
import TicketDetailPanel from './TicketDetailPanel';
import TicketStatusAdmin from './TicketStatusAdmin';
import TicketTypeAdmin from './TicketTypeAdmin';

/**
 * 面ごとの見出し。小さな見出しは設計ボード ST08 の文言（バックログ）と、面の名前（ほか）。
 * 一文は「この面で何をするか」を一言で。
 */
const HEADING: Record<BacklogView, { eyebrow: string; title: string; lede: (projectName: string) => string }> = {
  backlog: {
    eyebrow: 'Make room for the next thing',
    title: 'バックログ',
    lede: (name) => `${name} の次の一歩。いま動かす課題を選びましょう。`,
  },
  archive: {
    eyebrow: 'Archive',
    title: 'アーカイブ',
    lede: () => 'アーカイブしたチケット。必要なときに現役へ戻せます。',
  },
  settings: {
    eyebrow: 'Settings',
    title: '設定',
    lede: () => '状態・種別・スプリントの決まりごと。バックログの動き方をここで整えます。',
  },
};

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
    quickFilter,
    selectTicket,
    setStatusId,
    setTypeId,
    setLabelId,
    setQuickFilter,
    setQuery,
    clearFilters,
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
  const { bySprint, error: sprintTicketsError, reload: reloadSprintTickets } = useSprintTickets(
    workspaceSlug ?? undefined,
    openSprints.map((sprint) => sprint.id),
  );
  // スプリント側が読めなかったことは必ず画面に出す。黙って隠すと、スプリントに
  // 入っているはずのチケットがバックログに並んだまま「そういう状態だ」と読めてしまう。
  const sprintError = sprints.error ?? sprintTicketsError;
  // 一覧の「再読み込み」はチケットの一覧しか取り直さないので、スプリント側の失敗は
  // そのままでは戻せない。知らせるだけで終わらせず、その場でやり直せるようにする。
  const retrySprints = () => {
    void sprints.reload();
    void reloadSprintTickets();
  };
  const { principals, nameOf } = usePrincipalNames(workspaceSlug ?? undefined);
  // 「保存した絞り込み」の件数と全件数。柱ではなく一覧の真上に出す（設計ボード ST08）。
  const counts = useBacklogFilterCounts(workspaceSlug ?? undefined, project?.id);

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

  const handleCreateBlank = () =>
    void withToastOnFailure(
      () => list.createTicket({ title: '無題のチケット' }).then((t) => handleSelect(t.id)),
      'チケットを作成できませんでした。',
    );

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

      <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col overflow-hidden">
        {projectError ? (
          <div role="alert" className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-text-muted)]">
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
          <div role="status" className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
            読み込み中…
          </div>
        ) : (
          <>
            {/*
              見出しの塊（設計ボード ST08）。プロジェクトの行 → 小さな見出し → 大きな面の名前 → 一文 →
              保存した絞り込み。面のタブはプロジェクトの行の右端。柱に同じ行き先を置かない。
            */}
            <div className="shrink-0 border-b border-surface-3 px-4 pb-3 pt-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-taupe-600 text-[11px] font-bold text-white"
                  >
                    {project.key.replace(/[^A-Za-z0-9]/g, '').slice(0, 2).toUpperCase() || project.key.slice(0, 2).toUpperCase()}
                  </span>
                  <span className="min-w-0 truncate font-semibold text-[var(--color-text-primary)]">{project.name}</span>
                  <span aria-hidden="true" className="text-[var(--color-text-faint)]">/</span>
                  <span className="shrink-0 text-[var(--color-text-muted)]">プロジェクト {project.key.toUpperCase()}</span>
                </div>
                <BacklogTabs projectId={project.id} current={view} />
              </div>

              <p className="mt-4 font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-brand-700" aria-hidden="true">
                {HEADING[view].eyebrow}
              </p>
              <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight text-[var(--color-text-primary)] sm:text-4xl">
                {HEADING[view].title}
              </h1>
              <p className="mt-2 max-w-[44em] text-sm text-[var(--color-text-muted)]">{HEADING[view].lede(project.name)}</p>

              {view === 'backlog' && !enabled && !masters.loading && !masters.error && (
                <button
                  type="button"
                  onClick={() => void handleEnable()}
                  disabled={enabling}
                  className="mt-4 min-h-11 shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
                >
                  {enabling ? '有効化中…' : 'チケットを有効化'}
                </button>
              )}

              {view === 'backlog' && enabled && (
                <div className="mt-3">
                  <BacklogQuickFilters counts={counts} value={quickFilter} onChange={setQuickFilter} />
                </div>
              )}
            </div>

            {view !== 'settings' && enabled && (
              <BacklogFilterBar
                statuses={masters.statuses}
                types={masters.types}
                labels={labels.labels}
                statusId={statusId}
                typeId={typeId}
                labelId={labelId}
                q={q}
                quick={quickFilter}
                onChangeStatusId={setStatusId}
                onChangeTypeId={setTypeId}
                onChangeLabelId={setLabelId}
                onChangeQuery={setQuery}
                onClearQuick={() => setQuickFilter(null)}
                onClearFilters={clearFilters}
                onCreate={view === 'backlog' ? handleCreateBlank : undefined}
              />
            )}

            <div className="min-h-0 flex-1">
              {masters.loading && <Loading className="min-h-56" message="チケットの設定を読み込んでいます" />}
              {!masters.loading && masters.error && <EmptyState headingLevel={2} icon={ExclamationCircleIcon} title="チケットの設定を読み込めませんでした" description={masters.error} action={{ label: '再読み込み', onClick: masters.refresh }} />}
              {view !== 'settings' && !masters.loading && !masters.error &&
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
                  <div className="flex h-full min-h-0 flex-col">
                    {sprintError && (
                      // 一覧そのものは読めているので画面は塞がない。ただし
                      // 「スプリントの中身が空なのか、読めなかったのか」は必ず区別させる。
                      <p
                        role="status"
                        className="mx-4 mt-3 flex items-center gap-2 rounded-md border border-surface-3 bg-surface-2 px-3 py-2 text-xs text-[var(--color-text-muted)]"
                      >
                        <span>{sprintError}</span>
                        <button
                          type="button"
                          onClick={retrySprints}
                          className="rounded border border-surface-3 px-2 py-0.5 font-medium text-[var(--color-text-secondary)] hover:bg-surface-1"
                        >
                          再試行
                        </button>
                      </p>
                    )}
                    <BacklogList
                      filtered={Boolean(statusId || typeId || labelId || assignedToMe || unassigned || overdue || q)}
                      totalCount={counts?.total ?? null}
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
                            className="rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition-colors duration-fast hover:bg-surface-2 disabled:opacity-50"
                          >
                            {group.sprintState === 'active' ? 'スプリントを完了' : 'スプリントを開始'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void handleCreateSprint()}
                            className="rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] transition-colors duration-fast hover:bg-surface-2"
                          >
                            スプリントを作成
                          </button>
                        )
                      }
                      onRetry={list.refresh}
                    />
                  </div>
                ))}

              {/* 見出しは h1（プロジェクト名）→ h2（節）の順に落とす。節の名前を付けないと
                  管理の面が 3 つ続けて並ぶだけになり、中の EmptyState の h3 まで段が飛ぶ。 */}
              {view === 'settings' && !masters.loading && !masters.error && (
                <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
                <div className="mx-auto max-w-4xl space-y-10 [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11">
                  <section>
                    <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">状態</h2>
                    <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-muted)]">作業がどこまで進んだかを表す流れです。新しいチケットの開始状態もここで選べます。</p>
                    <TicketStatusAdmin
                      statuses={masters.statuses}
                      onCreate={masters.createStatus}
                      onSetInitial={masters.setInitialStatus}
                      onArchive={masters.archiveStatus}
                    />
                  </section>
                  <section>
                    <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">種別</h2>
                    <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-muted)]">チームの仕事に合わせて分類と雛形を整えます。</p>
                    <TicketTypeAdmin
                      types={masters.types}
                      onCreate={masters.createType}
                      onSetDefault={masters.setDefaultType}
                      onArchive={masters.archiveType}
                    />
                  </section>
                  <section>
                    <h2 className="mb-2 text-lg font-semibold text-[var(--color-text-primary)]">スプリント</h2>
                    <p className="mb-4 text-sm leading-relaxed text-[var(--color-text-muted)]">取り組む期間を管理します。作業の割り当てはバックログで行えます。</p>
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
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {view !== 'settings' && selectedTicket && (
        <SecondaryPanel
          title={`選択中 ${formatTicketKey(project?.key ?? '', selectedTicket.number)}`}
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
                className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-surface-3 text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
              >
                <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
              <button
                type="button"
                onClick={() => selectTicket(null)}
                aria-label="選択解除"
                title="選択解除"
                className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-surface-3 text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
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
