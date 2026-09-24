import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ConfirmModal, EmptyState, FsIllustration, Loading, NameCreateForm } from '@/shared/ui';
import { useToast } from '@/shared/lib/hooks/useToast';
import { useMediaQuery } from '@/shared/lib/hooks/useMediaQuery';
import { getApiError } from '@/shared/lib/classifyApiError';
import { TicketRepository, formatTicketKey, type TicketSavedFilter } from '@/entities/ticket';
import { ProjectRepository } from '@/entities/project';
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
import { formatPeriodShort } from '../lib/dueDate';
import { sprintConfirmText } from '../lib/sprintConfirm';
import { nextSprintName } from '../lib/nextSprintName';
import { projectInitials } from '../lib/projectInitials';
import { useBacklogFilterCounts } from '../model/useBacklogFilterCounts';
import { useSavedFilters } from '../model/useSavedFilters';
import { useBacklogReorder } from '../model/useBacklogReorder';
import { useWriteOutcomes } from '../model/useWriteOutcomes';
import { savedFilterErrorMessage } from '../lib/savedFilterError';
import { focusTicketRow } from '../lib/focusTicketRow';
import BacklogProjectSwitcher from './BacklogProjectSwitcher';
import BacklogSelectionBand from './BacklogSelectionBand';
import SaveFilterControl from './SaveFilterControl';
import TicketDetailPane from './TicketDetailPane';
import TicketDetailSheet from './TicketDetailSheet';

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
    savedFilterId,
    assignee,
    filtered,
    quickFilter,
    selectTicket,
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
  // 狭い画面では、選ぶ（帯が出る）と開く（全画面の詳細）を別の操作にする（設計ボード ST12・ST13）。
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  // 並び替えの結果（「1 つ上へ動かしました」）。選択中の帯に出し、読み上げにも通知する。
  const [moveMessage, setMoveMessage] = useState<string | null>(null);
  // 広い画面（詳細を右の列に出す）か、狭い画面（一覧の下の帯と全画面の詳細）か。
  // どちらか片方しか描かない —— 同じ詳細を 2 か所に描くと取得も下書きも二重に動く。
  const wide = !useMediaQuery('(max-width: 767px)');
  // 行を押して開いたチケット。そのときだけ詳細の見出しへフォーカスを移す（URL から選択付きで
  // 開いた直後にフォーカスを奪わない）。
  const [focusDetailFor, setFocusDetailFor] = useState<string | null>(null);
  // 保存した絞り込みへの操作（保存・改名・削除）の結果。操作した場所（タブの並びの下）に出す。
  const [filterMessage, setFilterMessage] = useState<string | null>(null);
  // 保存した絞り込みの削除は確認を挟む（消すと同じ条件を組み直すしかない）。
  const [deletingFilter, setDeletingFilter] = useState<TicketSavedFilter | null>(null);
  const [deleteFilterPending, setDeleteFilterPending] = useState(false);
  const [enabling, setEnabling] = useState(false);
  // スプリントの完了は開始し直せないので確認を挟む（開始は確認しない）。
  const [completing, setCompleting] = useState<{ sprintId: string; name: string; count: number } | null>(null);
  const [completePending, setCompletePending] = useState(false);

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
  // 「保存した絞り込み」の件数と全件数。一覧の真上に出す（設計ボード ST08）。
  const counts = useBacklogFilterCounts(workspaceSlug ?? undefined, project?.id);
  // 利用者が名前を付けて保存した絞り込み（件数付き）。固定のタブの後ろに並ぶ（設計ボード ST09）。
  const saved = useSavedFilters(workspaceSlug ?? undefined, project?.id);

  // チケットを動かしたら（状態・担当・期限・ラベル・作成・アーカイブ）件数を取り直す。
  // 一覧の読み直しでは動かない（mutations は書き込みの成功でだけ増える）。
  const refreshCounts = counts.refresh;
  const refreshSaved = saved.refresh;
  useEffect(() => {
    if (list.mutations === 0) return;
    refreshCounts();
    refreshSaved();
  }, [list.mutations, refreshCounts, refreshSaved]);

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
    // openSprints は毎回新しい配列になるので、中身の署名で見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.tickets, bySprint, openSprints.map((s) => `${s.id}:${s.name}:${s.state}`).join(',')]);

  // プロジェクトを切り替えたら文脈を捨てる（前のプロジェクトのチケットを次の画面で引きずらない）。
  // 初回の読み込みでは捨てない — URL に載っている選択や絞り込みを開いた直後に消してしまう。
  const shownProject = useRef<string | null>(null);
  useEffect(() => {
    const id = project?.id ?? null;
    if (shownProject.current !== null && shownProject.current !== id) {
      reset();
      setFilterMessage(null);
      setMobileDetailOpen(false);
      setMoveMessage(null);
    }
    shownProject.current = id;
  }, [project?.id, reset]);

  const enabled = !masters.loading && !masters.error && masters.statuses.length > 0;
  const selectedTicket = selectedId ? list.tickets.find((t) => t.id === selectedId) ?? null : null;
  const parentTicket = selectedTicket?.parentId
    ? list.tickets.find((t) => t.id === selectedTicket.parentId)
    : undefined;
  const selectedKey = selectedTicket && project ? formatTicketKey(project.key, selectedTicket.number) : null;

  // 並び替えは「選んだ行が入っている段の中」で行う。段をまたぐ移動は別の操作（スプリントへ
  // 入れる／から出す）。どちらも選択中の帯から。
  const reorder = useBacklogReorder(groups, selectedTicket?.id ?? null, {
    onMove: list.move,
    onMoveInSprint: (ticketId, anchorTicketId, anchorAfter) =>
      sprints.moveTicket(ticketId, anchorTicketId, anchorAfter).then(() => list.refresh()),
  });

  // 一覧の行で状態を変えた結果（行ごと）。
  const rowOutcomes = useWriteOutcomes<string>();

  /** 結果が分からない失敗のあとの「最新を確認」。一覧・件数・状態と種別の選択肢を取り直す。 */
  const refreshAll = () => {
    list.refresh();
    masters.refresh();
    counts.refresh();
    saved.refresh();
  };

  /** 並び替えの結果を帯に出す。失敗は知らせて、一覧は動かさない。 */
  const announceMove = (action: Promise<unknown>, doneMessage: string, failMessage: string) => {
    setMoveMessage(null);
    void action.then(() => setMoveMessage(doneMessage)).catch(() => showToast('error', failMessage));
  };

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
    setFocusDetailFor(ticketId);
    setMoveMessage(null);
  };

  /** 狭い画面の全画面の詳細から一覧へ戻る。選択は残し、開いた行へフォーカスを戻す。 */
  const backToList = () => {
    setMobileDetailOpen(false);
    if (selectedId) focusTicketRow(selectedId);
  };

  /**
   * 選択を外して詳細を閉じる（選択解除・Escape）。閉じたら起点の行へフォーカスを戻す
   * （設計ボード ST14 の 04）。狭い画面の「一覧へ」は別の操作 —— 選択は残る。
   */
  const closeDetail = () => {
    const id = selectedId;
    selectTicket(null);
    setMobileDetailOpen(false);
    setMoveMessage(null);
    if (id) focusTicketRow(id);
  };

  const handleCreateBlank = () =>
    void withToastOnFailure(
      () => list.createTicket({ title: '無題のチケット' }).then((t) => handleSelect(t.id)),
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

  /**
   * 選択中の帯（ST14 の 01）。広い画面では詳細の上、狭い画面では一覧の下。中身は同じで、
   * 狭い画面だけ「選択した課題をひらく」が付く。
   */
  const selectionBand = (variant: 'header' | 'bottom') =>
    selectedTicket && selectedKey ? (
      <BacklogSelectionBand
        variant={variant}
        selectedKey={selectedKey}
        groupName={reorder.ownerGroup?.name ?? null}
        isFirst={reorder.isFirst}
        isLast={reorder.isLast}
        canReorder={!archived}
        onMoveUp={() => announceMove(reorder.moveUp(), `${selectedKey} を 1 つ上へ動かしました`, '並び替えできませんでした。')}
        onMoveDown={() => announceMove(reorder.moveDown(), `${selectedKey} を 1 つ下へ動かしました`, '並び替えできませんでした。')}
        onMoveLast={() => announceMove(reorder.moveLast(), `${selectedKey} を末尾へ動かしました`, '並び替えできませんでした。')}
        sprints={reorder.otherSprints}
        onMoveToSprint={(sprintId) =>
          announceMove(
            sprints.addTicket(sprintId, selectedTicket.id),
            `${selectedKey} を${reorder.otherSprints.find((s) => s.id === sprintId)?.name ?? 'スプリント'}へ入れました`,
            'スプリントへ入れられませんでした。',
          )
        }
        onRemoveFromSprint={
          reorder.ownerGroup?.kind === 'sprint'
            ? () =>
                announceMove(
                  sprints.removeTicket(selectedTicket.id),
                  `${selectedKey} をスプリントから出しました`,
                  'スプリントから出せませんでした。',
                )
            : undefined
        }
        onDeselect={closeDetail}
        onOpenDetail={variant === 'bottom' ? () => setMobileDetailOpen(true) : undefined}
        message={moveMessage}
      />
    ) : null;

  /** 詳細の中身。広い画面の列と狭い画面の全画面のどちらか片方にだけ差し込む。 */
  const detailPanel = selectedTicket ? (
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
      // 状態・担当・ラベル・親の結果はパネルが項目のすぐ下に出す（PX04）。ここは失敗を投げ返すだけ。
      onChangeStatus={(statusId) => list.changeStatus(selectedTicket.id, { statusId })}
      onAssign={(principalId) => list.assign(selectedTicket.id, principalId)}
      onUnassign={() => list.unassign(selectedTicket.id)}
      onArchive={() =>
        withToastOnFailure(() => list.archiveTicket(selectedTicket.id), 'アーカイブできませんでした。').then(closeDetail)
      }
      onRestore={() =>
        withToastOnFailure(() => list.restoreTicket(selectedTicket.id), '現役に戻せませんでした。').then(closeDetail)
      }
      onToggleLabel={(label, attached) =>
        attached ? list.removeLabel(selectedTicket.id, label.id) : list.addLabel(selectedTicket.id, label)
      }
      onCreateLabel={(name, color) => labels.createLabel({ name, color })}
      onChangeParent={(parentId) => list.changeParent(selectedTicket.id, parentId)}
      onRefresh={refreshAll}
    />
  ) : null;

  return (
    // 左の列は持たない（設計ボード ST08: バックログは全幅）。プロジェクトの切替は見出しの上の
    // 文脈の行に置く。
    <div className="flex h-full overflow-hidden">
      {/*
        一覧の側。本文のランドマーク（main）は枠（AppShell）が持つので、ここは div にする
        （main の中に main を置かない）。狭い画面で全画面の詳細を重ねている間は inert にして、
        Tab が裏の一覧へ抜けないようにする（一覧は描いたまま重ねるので、戻ればスクロール位置も残る）。
      */}
      <div
        inert={!wide && mobileDetailOpen}
        className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col overflow-hidden"
      >
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
              <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                プロジェクトを作るとバックログを使えるようになります。
              </p>
              {workspaceSlug && (
                <div className="mx-auto max-w-sm text-left">
                  <NameCreateForm
                    what="プロジェクト"
                    onCreate={async ({ name }) => {
                      const created = await ProjectRepository.createProject(workspaceSlug, { name });
                      navigate(backlogPath(created.id, 'backlog'));
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : projectLoading || !project ? (
          <div role="status" className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
            読み込み中…
          </div>
        ) : (
          <>
            {/*
              見出しの塊（設計ボード ST08）。文脈の行（印・プロジェクト名 / プロジェクト KEY ▾ と、右端に
              面のタブ）→ 小さな見出し → 大きな面の名前 → 一文 → 保存した絞り込み。
            */}
            <div className="shrink-0 border-b border-surface-3 px-4 pb-3 pt-4 sm:px-6">
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                {/* 狭い画面では印と名前を畳み、切替（「プロジェクト KEY ▾」）だけを残す（設計ボード ST12）。
                    面のタブと 1 行に収めて、一覧の 1 行目を上へ上げる。 */}
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span
                    aria-hidden="true"
                    className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md bg-taupe-600 text-xs font-bold text-white sm:flex"
                  >
                    {projectInitials(project.key)}
                  </span>
                  <span className="hidden min-w-0 truncate font-semibold text-[var(--color-text-primary)] sm:inline">{project.name}</span>
                  <span aria-hidden="true" className="hidden text-[var(--color-text-faint)] sm:inline">/</span>
                  <BacklogProjectSwitcher workspaceSlug={workspaceSlug ?? undefined} project={project} />
                </div>
                <BacklogTabs projectId={project.id} current={view} />
              </div>

              <p className="mt-3 font-mono text-xs font-medium uppercase tracking-[0.14em] text-brand-700 sm:mt-4" aria-hidden="true">
                {HEADING[view].eyebrow}
              </p>
              <h1 className="mt-1 text-3xl font-bold leading-tight tracking-tight text-[var(--color-text-primary)] sm:text-4xl">
                {HEADING[view].title}
              </h1>
              {/* 一文は狭い画面では出さない（ST12）。見出しで面は分かり、縦の場所は一覧に回す。 */}
              <p className="mt-2 hidden max-w-[44em] text-sm text-[var(--color-text-muted)] sm:block">{HEADING[view].lede(project.name)}</p>

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
                    <p role="alert" className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
                      <span>{saved.error}</span>
                      <button
                        type="button"
                        onClick={saved.refresh}
                        className="min-h-9 rounded px-1.5 underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                      >
                        再試行
                      </button>
                    </p>
                  )}
                  {/* 保存・改名・削除の結果は、操作したタブの並びのすぐ下に出す（トーストだけにしない）。 */}
                  {filterMessage && (
                    <p role="status" className="mt-1 text-xs text-[var(--color-text-secondary)]">
                      {filterMessage}
                    </p>
                  )}
                </div>
              )}
            </div>

            {view !== 'settings' && enabled && (
              <BacklogFilterBar
                statuses={masters.statuses}
                types={masters.types}
                labels={labels.labels}
                principals={principals}
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
                onCreate={view === 'backlog' ? handleCreateBlank : undefined}
              />
            )}

            <div className="min-h-0 flex-1">
                {masters.loading && <Loading className="min-h-56" message="チケットの設定を読み込んでいます" />}
                {!masters.loading && masters.error && <EmptyState headingLevel={2} illustration={<FsIllustration name="load-error" />} title="チケットの設定を読み込めませんでした" description={masters.error} action={{ label: '再読み込み', onClick: masters.refresh }} />}
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
                    {/* 一覧は残りの高さを使い、狭い画面の選択中の帯はその下に常に見える位置に置く。 */}
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
                      selectedId={selectedId}
                      busyId={list.busyId}
                      nameOf={nameOf}
                      onSelect={handleSelect}
                      // 狭い画面だけ、選択中のカードに「詳細をひらく」を出す（広い画面は右に開いている）。
                      onOpenDetail={wide ? undefined : () => setMobileDetailOpen(true)}
                      onCreate={(title) => list.createTicket({ title }).then((t) => handleSelect(t.id))}
                      // 行の状態変更の結果は、その行のすぐ下に出す（PX04。トーストだけにしない）。
                      onChangeStatus={(ticketId, nextStatusId) => {
                        const name = masters.statuses.find((st) => st.id === nextStatusId)?.name ?? '選んだ状態';
                        void rowOutcomes.run(ticketId, () => list.changeStatus(ticketId, { statusId: nextStatusId }), {
                          saving: `「${name}」に変更しています…`,
                          saved: `状態を「${name}」にしました`,
                          fallback: '状態を変えられませんでした。',
                          reasons: { status_not_found: 'この状態は今は選べません。選択肢を更新してください。' },
                        });
                      }}
                      outcomeOf={rowOutcomes.outcomeOf}
                      onVerify={refreshAll}
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
                      // 条件が付いていて、まだ名前が付いていないときだけ「この絞り込みを保存」。
                      // 保存済みのタブを選んでいる間は出さない（同じ条件をもう 1 つ作らせない）。
                      footerAction={
                        view === 'backlog' && filtered && !savedFilterId ? (
                          <SaveFilterControl onSave={handleSaveFilter} />
                        ) : undefined
                      }
                      onRetry={list.refresh}
                    />
                    </div>
                    {/* 狭い画面の選択中の帯（設計ボード ST12）。一覧の下に出て、開く・並び替え・選択解除を持つ。 */}
                    {!wide && selectedTicket && selectionBand('bottom')}
                  </div>
                ))}

              {/* 見出しは h1（プロジェクト名）→ h2（節）の順に落とす。節の名前を付けないと
                  管理の面が 3 つ続けて並ぶだけになり、中の EmptyState の h3 まで段が飛ぶ。 */}
              {view === 'settings' && !masters.loading && !masters.error && (
                <div className="h-full overflow-y-auto px-4 py-6 sm:px-6">
                {/* 左端は見出しの塊（px-4 sm:px-6）にそろえる。中央に寄せると見出しと本文の左端がずれる。 */}
                <div className="max-w-4xl space-y-10 [&_button]:min-h-11 [&_input]:min-h-11 [&_select]:min-h-11">
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
      </div>

      {/*
        詳細は画面幅で出し分ける。広い画面は右の列（ST10）、狭い画面は全画面の 1 列（ST13）。
        全画面へは本文の身元（キー・種別）のリンクから開く。帯に同じ行き先の矢印を置くと
        入口が 2 つになるので持たない。帯に残すのは選択を解く操作と並び替えだけ。
      */}
      {view !== 'settings' && selectedTicket && wide && (
        <TicketDetailPane
          key={selectedTicket.id}
          band={selectionBand('header')}
          onClose={closeDetail}
          autoFocus={focusDetailFor === selectedTicket.id}
        >
          {detailPanel}
        </TicketDetailPane>
      )}
      {view !== 'settings' && selectedTicket && !wide && (
        <TicketDetailSheet open={mobileDetailOpen} label={`選択中 ${selectedKey ?? ''}`} onBack={backToList}>
          {detailPanel}
        </TicketDetailSheet>
      )}

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
    </div>
  );
}
