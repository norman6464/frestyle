import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ConfirmModal, EmptyState, ErrorNotice, FsIllustration, Loading } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useStableCallback } from '@/shared/lib/hooks/useStableCallback';
import { getApiError } from '@/shared/lib/classifyApiError';
import { TicketRepository, type TicketSavedFilter } from '@/entities/ticket';
import type { SprintState } from '@/entities/sprint';
import { useTicketList } from '../model/useTicketList';
import { useTicketMasters } from '../model/useTicketMasters';
import { useTicketLabels } from '../model/useTicketLabels';
import { usePrincipalNames } from '../model/usePrincipalNames';
import { useBacklogOutlet } from '../model/backlogOutlet';
import { useBacklogUrlState } from '../model/useBacklogUrlState';
import BacklogFilterBar from './BacklogFilterBar';
import BacklogQuickFilters from './BacklogQuickFilters';
import BacklogList, { BACKLOG_GROUP_ID, type BacklogGroupModel } from './BacklogList';
import BacklogFrame from './BacklogFrame';
import { useSprints } from '../model/useSprints';
import { useSprintTickets } from '../model/useSprintTickets';
import { formatPeriodShort } from '../lib/dueDate';
import { sprintConfirmText } from '../lib/sprintConfirm';
import { nextSprintName } from '../lib/nextSprintName';
import { ticketLinkState } from '../lib/ticketLinkState';
import { useBacklogFilterCounts } from '../model/useBacklogFilterCounts';
import { useSavedFilters } from '../model/useSavedFilters';
import { useWriteOutcomes } from '../model/useWriteOutcomes';
import { savedFilterErrorMessage } from '../lib/savedFilterError';
import SaveFilterControl from './SaveFilterControl';

export interface BacklogTicketsPageProps {
  /** アーカイブの面か。経路が決める（/backlog/:projectId は現役、/archive はアーカイブ）。 */
  archived?: boolean;
}

/**
 * BacklogTicketsPage はバックログの一覧の面（現役・アーカイブ）。container（設計 0・Ⅲ・Ⅵ）。
 *
 * スプリントは別の面にせず、本文の段としてバックログの上に積む（見本と同じ）。現役とアーカイブは
 * 同じ部品で、面を行き来しても見出しとタブは作り直さない。
 */
export default function BacklogTicketsPage({ archived = false }: BacklogTicketsPageProps) {
  const { workspaceSlug, project } = useBacklogOutlet();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  // 面・アーカイブの切り替えと絞り込みは URL に持つ。チケットを開いて戻ったときに絞り込みが
  // 残るようにするため（useBacklogUrlState）。開いたチケットそのものは選ばず、独立した票
  // （/tickets/:id）へ直接移る —— 一覧の上に重ねる面は持たない。
  const {
    statusId,
    typeId,
    labelId,
    unassigned,
    assignedToMe,
    overdue,
    q,
    savedFilterId,
    assignee,
    filtered,
    quickFilter,
    setStatusId,
    setTypeId,
    setLabelId,
    setAssignee,
    setOverdue,
    setQuickFilter,
    setQuery,
    applySavedFilter,
    clearFilters,
    reset,
  } = useBacklogUrlState();
  // 保存した絞り込みへの操作（保存・改名・削除）の結果。操作した場所（タブの並びの下）に出す。
  const [filterMessage, setFilterMessage] = useState<string | null>(null);
  // 保存した絞り込みの削除は確認を挟む（消すと同じ条件を組み直すしかない）。
  const [deletingFilter, setDeletingFilter] = useState<TicketSavedFilter | null>(null);
  const [deleteFilterPending, setDeleteFilterPending] = useState(false);
  const [enabling, setEnabling] = useState(false);
  // スプリントの完了は開始し直せないので確認を挟む（開始は確認しない）。
  const [completing, setCompleting] = useState<{ sprintId: string; name: string; count: number } | null>(null);
  const [completePending, setCompletePending] = useState(false);

  const list = useTicketList(workspaceSlug, project.id, {
    archived,
    statusId: statusId ?? undefined,
    typeId: typeId ?? undefined,
    labelId: labelId ?? undefined,
    unassigned,
    assignedToMe,
    overdue,
    q: q || undefined,
  });
  const masters = useTicketMasters(workspaceSlug, project.id);
  const labels = useTicketLabels(workspaceSlug);
  // スプリントは段の見出し（開始・完了）と選択中の帯（入れ先の選択）の両方が使うので、
  // ページで 1 つ持って両方へ渡す。
  const sprints = useSprints(workspaceSlug, project.id);
  // どのチケットがどのスプリントに入っているかは ID だけ引き、中身は一覧の応答から引き当てる。
  const openSprints = useMemo(() => sprints.sprints.filter((sprint) => sprint.state !== 'completed'), [sprints.sprints]);
  const { bySprint, error: sprintTicketsError, reload: reloadSprintTickets } = useSprintTickets(
    workspaceSlug,
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
  const { members, nameOf } = usePrincipalNames(workspaceSlug);
  // 「保存した絞り込み」の件数と全件数。一覧の真上に出す（設計ボード ST08）。
  const counts = useBacklogFilterCounts(workspaceSlug, project.id);
  // 利用者が名前を付けて保存した絞り込み（件数付き）。固定のタブの後ろに並ぶ（設計ボード ST09）。
  const saved = useSavedFilters(workspaceSlug, project.id);

  // チケットを動かしたら（状態・担当・期限・ラベル・作成・アーカイブ）、件数と保存した絞り込みの
  // 件数は書き込みの側（useTicketList の refreshTicketDerived）が古いものにして取り直させる。

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
      const period = formatPeriodShort(sprint.startDate, sprint.endDate);
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
  }, [list.tickets, bySprint, openSprints]);

  // プロジェクトを切り替えたら文脈を捨てる（前のプロジェクトのチケットを次の画面で引きずらない）。
  // 初回の読み込みでは捨てない — URL に載っている選択や絞り込みを開いた直後に消してしまう。
  const shownProject = useRef<string | null>(null);
  useEffect(() => {
    const id = project.id;
    if (shownProject.current !== null && shownProject.current !== id) {
      reset();
      setFilterMessage(null);
    }
    shownProject.current = id;
  }, [project.id, reset]);

  const enabled = !masters.loading && !masters.error && masters.statuses.length > 0;

  // 一覧の行で状態や並びを変えた結果（行ごと。PX04）。
  const rowOutcomes = useWriteOutcomes<string>();

  /** 結果が分からない失敗のあとの「最新を確認」。一覧・件数・状態と種別の選択肢を取り直す。 */
  const refreshAll = () => {
    list.refresh();
    masters.refresh();
    counts.refresh();
    saved.refresh();
  };

  const handleEnable = async () => {
    setEnabling(true);
    try {
      await TicketRepository.enable(workspaceSlug, project.id);
      masters.refresh();
      list.refresh();
    } catch {
      showToast('error', 'チケットを有効化できませんでした。');
    }
    // finally にしない（React Compiler が try … finally を扱えず、この部品ごと対象から外す）。
    // catch は投げ直さず try の中で return もしないので、ここに置いても必ず通る。
    setEnabling(false);
  };

  // 一覧の行へ渡す関数。行は memo なので、いつも同じ関数を全行へ渡す。中で使う値（一覧の書き込み・
  // 取り直し）は操作のたびに作り直されるので、useCallback ではなく useStableCallback で
  // 「同じ入れ物・中身は最新」にする。JSX の中で作ると条件分岐ごと作り直され、1 行の変化で
  // 全行を描き直す。
  const handleRowVerify = useStableCallback(() => refreshAll());
  const handleCreateRow = useStableCallback(async (title: string) => {
    await list.createTicket({ title });
  });
  // 行の状態変更の結果は、その行のすぐ下に出す（PX04。トーストだけにしない）。
  const handleChangeRowStatus = useStableCallback((ticketId: string, nextStatusId: string) => {
    const name = masters.statuses.find((st) => st.id === nextStatusId)?.name ?? '選んだ状態';
    void rowOutcomes.run(ticketId, () => list.changeStatus(ticketId, { statusId: nextStatusId }), {
      saving: `「${name}」に変更しています…`,
      saved: `状態を「${name}」にしました`,
      fallback: '状態を変えられませんでした。',
      reasons: { status_not_found: 'この状態は今は選べません。選択肢を更新してください。' },
    });
  });

  /** チケットが入っている段（並び替えは同じ段の中だけ）。 */
  const groupOf = (ticketId: string) => groups.find((g) => g.tickets.some((t) => t.id === ticketId));
  /** 同じ段の中で 1 つ動かす。段の種類（バックログ／スプリント）で呼ぶ口が違う。 */
  const moveWithinGroup = (ticketId: string, group: BacklogGroupModel, anchorId: string, after: boolean) =>
    group.kind === 'sprint' ? sprints.moveTicket(ticketId, anchorId, after) : list.move(ticketId, { anchorTicketId: anchorId, anchorAfter: after });

  const handleMoveUp = useStableCallback((ticketId: string) => {
    const group = groupOf(ticketId);
    const index = group?.tickets.findIndex((t) => t.id === ticketId) ?? -1;
    if (!group || index <= 0) return;
    void rowOutcomes.run(ticketId, () => moveWithinGroup(ticketId, group, group.tickets[index - 1].id, false), {
      saving: '1 つ上へ動かしています…',
      saved: '1 つ上へ動かしました',
      fallback: '並び替えできませんでした。',
    });
  });

  const handleMoveDown = useStableCallback((ticketId: string) => {
    const group = groupOf(ticketId);
    const index = group?.tickets.findIndex((t) => t.id === ticketId) ?? -1;
    if (!group || index < 0 || index >= group.tickets.length - 1) return;
    void rowOutcomes.run(ticketId, () => moveWithinGroup(ticketId, group, group.tickets[index + 1].id, true), {
      saving: '1 つ下へ動かしています…',
      saved: '1 つ下へ動かしました',
      fallback: '並び替えできませんでした。',
    });
  });

  const handleMoveLast = useStableCallback((ticketId: string) => {
    const group = groupOf(ticketId);
    const index = group?.tickets.findIndex((t) => t.id === ticketId) ?? -1;
    if (!group || index < 0 || index >= group.tickets.length - 1) return;
    void rowOutcomes.run(
      ticketId,
      // バックログの「末尾へ」はアンカー無しの移動（末尾へ足す）。スプリントは末尾の 1 件を
      // アンカーにして after で入れる（口の形がそもそも違う）。
      () =>
        group.kind === 'sprint'
          ? sprints.moveTicket(ticketId, group.tickets[group.tickets.length - 1].id, true)
          : list.move(ticketId, {}),
      { saving: '末尾へ動かしています…', saved: '末尾へ動かしました', fallback: '並び替えできませんでした。' },
    );
  });

  const handleMoveToSprint = useStableCallback((ticketId: string, sprintId: string) => {
    const name = openSprints.find((s) => s.id === sprintId)?.name ?? 'スプリント';
    // どの段に出すかはスプリントの中身で決まる。入れたら取り直さないと、入れたのに
    // バックログの段に残って見える（スプリント一覧の件数だけが変わる）。
    void rowOutcomes.run(ticketId, () => sprints.addTicket(sprintId, ticketId).then(() => reloadSprintTickets()), {
      saving: `「${name}」へ入れています…`,
      saved: `「${name}」へ入れました`,
      fallback: 'スプリントへ入れられませんでした。',
    });
  });

  const handleRemoveFromSprint = useStableCallback((ticketId: string) => {
    void rowOutcomes.run(ticketId, () => sprints.removeTicket(ticketId).then(() => reloadSprintTickets()), {
      saving: 'スプリントから出しています…',
      saved: 'スプリントから出しました',
      fallback: 'スプリントから出せませんでした。',
    });
  });

  /** 「課題をつくる」。作ったら独立した票（/tickets/:id）へ移り、その場で書き込める。 */
  const handleCreateBlank = () =>
    void withToastOnFailure(
      () =>
        list
          .createTicket({ title: '無題のチケット' })
          .then((created) => navigate(`/tickets/${created.id}`, { state: ticketLinkState(location) })),
      'チケットを作成できませんでした。',
    );

  /**
   * 段の見出しから作る。名前は聞かずに連番で作る（Jira のバックログと同じ）。
   * 押すたびに入力欄を挟むと、並べ替えの流れが止まる。名前はプロジェクトの「設定」で変えられる。
   */
  const handleCreateSprint = async () => {
    const name = nextSprintName(sprints.sprints);
    try {
      await sprints.create({ name });
      showToast('success', `「${name}」を作りました。名前は「設定」で変えられます。`);
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

  /** 保存した絞り込みのタブを押した。押されているものをもう一度押すと条件ごと外す。 */
  const handleSelectSaved = (filter: TicketSavedFilter | null) => {
    setFilterMessage(null);
    if (filter) applySavedFilter(filter);
    else clearFilters();
  };

  /** いま URL に載っている条件に名前を付けて保存し、その絞り込みを選んだ状態にする。 */
  const handleSaveFilter = async (name: string) => {
    const created = await saved.create({
      name,
      statusId,
      typeId,
      labelId,
      assigneePrincipalId: assignee.kind === 'principal' ? assignee.id : null,
      unassigned: assignee.kind === 'none',
      assignedToMe: assignee.kind === 'me',
      overdue,
      q: q || null,
    });
    applySavedFilter(created);
    setFilterMessage(`絞り込み「${created.name}」を保存しました`);
  };

  const handleRenameSaved = async (filter: TicketSavedFilter, name: string) => {
    const updated = await saved.rename(filter, name);
    setFilterMessage(`絞り込みの名前を「${updated.name}」に変えました`);
  };

  const handleDeleteSaved = () => {
    const target = deletingFilter;
    if (!target) return;
    setDeleteFilterPending(true);
    void saved
      .remove(target.id)
      .then(() => {
        // 消したものを選んでいたら、条件ごと外す（無い絞り込みの名前の下に一覧を残さない）。
        if (savedFilterId === target.id) clearFilters();
        setFilterMessage(`絞り込み「${target.name}」を削除しました`);
      })
      .catch((cause: unknown) => {
        showToast('error', savedFilterErrorMessage(cause, '絞り込みを削除できませんでした。'));
      })
      .finally(() => {
        setDeleteFilterPending(false);
        setDeletingFilter(null);
      });
  };

  return (
    <BacklogFrame
      view={archived ? 'archive' : 'backlog'}
      workspaceSlug={workspaceSlug}
      project={project}
      headerExtra={
        archived ? null : (
          <>
            {!enabled && !masters.loading && !masters.error && (
              <button
                type="button"
                onClick={() => void handleEnable()}
                disabled={enabling}
                className="mt-4 min-h-11 shrink-0 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
              >
                {enabling ? '有効化中…' : 'チケットを有効化'}
              </button>
            )}

            {enabled && (
              <div className="mt-4">
                <BacklogQuickFilters
                  counts={counts.counts}
                  countsFailed={counts.failed}
                  value={quickFilter}
                  filtered={filtered}
                  onChange={(kind) => {
                    setFilterMessage(null);
                    setQuickFilter(kind);
                  }}
                  savedFilters={saved.filters}
                  savedFilterId={savedFilterId}
                  savedCountsFailed={saved.countsFailed}
                  onSelectSaved={handleSelectSaved}
                  onRenameSaved={handleRenameSaved}
                  onDeleteSaved={setDeletingFilter}
                />
                {/* 保存した絞り込みが読めなかったことは、無いことと区別して出す（0 件は何も出ない）。 */}
                {saved.error && (
                  <ErrorNotice variant="inline" message={saved.error} onRetry={saved.refresh} className="mt-1" />
                )}
                {/* 保存・改名・削除の結果は、操作したタブの並びのすぐ下に出す（トーストだけにしない）。 */}
                {filterMessage && (
                  <p role="status" className="mt-1 text-xs text-[var(--color-text-secondary)]">
                    {filterMessage}
                  </p>
                )}
              </div>
            )}
          </>
        )
      }
      aside={
        <>
          {deletingFilter && (
            <ConfirmModal
              isOpen
              title={`絞り込み「${deletingFilter.name}」を削除しますか？`}
              message="チケットは消えません。同じ条件が要るときは、もう一度名前を付けて保存し直すことになります。"
              confirmText="削除する"
              isDanger
              icon="trash"
              pending={deleteFilterPending}
              onConfirm={handleDeleteSaved}
              onCancel={() => setDeletingFilter(null)}
            />
          )}

          {completing && (
            <ConfirmModal
              isOpen
              {...sprintConfirmText('complete', completing.name, completing.count)}
              isDanger
              pending={completePending}
              onConfirm={() => {
                const target = completing;
                setCompletePending(true);
                void handleChangeSprintState(target.sprintId, 'active').finally(() => {
                  setCompletePending(false);
                  setCompleting(null);
                });
              }}
              onCancel={() => setCompleting(null)}
            />
          )}
        </>
      }
    >
      {enabled && (
        <BacklogFilterBar
          statuses={masters.statuses}
          types={masters.types}
          labels={labels.labels}
          members={members}
          statusId={statusId}
          typeId={typeId}
          labelId={labelId}
          assignee={assignee}
          overdue={overdue}
          q={q}
          onChangeStatusId={setStatusId}
          onChangeTypeId={setTypeId}
          onChangeLabelId={setLabelId}
          onChangeAssignee={setAssignee}
          onChangeOverdue={setOverdue}
          onChangeQuery={setQuery}
          onClearFilters={clearFilters}
          onCreate={archived ? undefined : handleCreateBlank}
        />
      )}

      <div className="min-h-0 flex-1">
        {masters.loading && <Loading className="min-h-56" message="チケットの設定を読み込んでいます" />}
        {!masters.loading && masters.error && <EmptyState headingLevel={2} illustration={<FsIllustration name="load-error" />} title="チケットの設定を読み込めませんでした" description={masters.error} action={{ label: '再読み込み', onClick: masters.refresh }} />}
        {!masters.loading && !masters.error &&
          (!enabled ? (
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
                // 一覧そのものは読めているので画面は塞がない（status）。ただし
                // 「スプリントの中身が空なのか、読めなかったのか」は必ず区別させる。
                <ErrorNotice
                  variant="inline"
                  politeness="polite"
                  message={sprintError}
                  onRetry={retrySprints}
                  className="mx-4 mt-3 rounded-md border border-surface-3 bg-surface-2 px-3"
                />
              )}
              {/* 一覧は残りの高さを使う。 */}
              <div className="min-h-0 flex-1">
                <BacklogList
                  filtered={filtered}
                  totalCount={counts.counts?.total ?? null}
                  groups={groups}
                  statuses={masters.statuses}
                  types={masters.types}
                  projectKey={project.key}
                  loading={list.loading}
                  error={list.error}
                  archived={archived}
                  canEdit
                  busyId={list.busyId}
                  nameOf={nameOf}
                  onCreate={handleCreateRow}
                  onChangeStatus={handleChangeRowStatus}
                  onMoveUp={handleMoveUp}
                  onMoveDown={handleMoveDown}
                  onMoveLast={handleMoveLast}
                  onMoveToSprint={handleMoveToSprint}
                  onRemoveFromSprint={handleRemoveFromSprint}
                  outcomeOf={rowOutcomes.outcomeOf}
                  onVerify={handleRowVerify}
                  renderGroupAction={(group) =>
                    group.kind === 'sprint' ? (
                      <button
                        type="button"
                        disabled={sprints.busyId === group.id}
                        onClick={() => {
                          if (group.sprintState === 'active') {
                            setCompleting({ sprintId: group.id, name: group.name, count: group.tickets.length });
                            return;
                          }
                          void handleChangeSprintState(group.id, group.sprintState);
                        }}
                        className="rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors duration-fast hover:bg-surface-2 disabled:opacity-50"
                      >
                        {group.sprintState === 'active' ? 'スプリントを完了' : 'スプリントを開始'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void handleCreateSprint()}
                        className="rounded-md border border-surface-3 bg-surface-1 px-3 py-1.5 text-[13px] font-medium text-[var(--color-text-secondary)] transition-colors duration-fast hover:bg-surface-2"
                      >
                        スプリントを作成
                      </button>
                    )
                  }
                  // 条件が付いていて、まだ名前が付いていないときだけ「この絞り込みを保存」。
                  // 保存済みのタブを選んでいる間は出さない（同じ条件をもう 1 つ作らせない）。
                  footerAction={!archived && filtered && !savedFilterId ? <SaveFilterControl onSave={handleSaveFilter} /> : undefined}
                  onRetry={list.refresh}
                />
              </div>
            </div>
          ))}
      </div>
    </BacklogFrame>
  );
}
