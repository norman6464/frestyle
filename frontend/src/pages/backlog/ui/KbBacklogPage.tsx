import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Bars3Icon } from '@heroicons/react/24/outline';
import { KbSidebar } from '@/widgets/kb-sidebar';
import { SecondaryPanel } from '@/widgets/secondary-panel';
import { useMobilePanelState } from '@/shared/lib/hooks/useMobilePanelState';
import { useToast } from '@/shared/lib/hooks/useToast';
import { getApiError } from '@/shared/lib/classifyApiError';
import { TicketRepository } from '@/entities/ticket';
import { useTicketList } from '../model/useTicketList';
import { useTicketMasters } from '../model/useTicketMasters';
import { useTicketLabels } from '../model/useTicketLabels';
import { usePrincipalNames } from '../model/usePrincipalNames';
import { useBacklogSpace } from '../model/useBacklogSpace';
import { useBacklogUrlState } from '../model/useBacklogUrlState';
import BacklogFilterBar from './BacklogFilterBar';
import BacklogList from './BacklogList';
import TicketDetailPanel from './TicketDetailPanel';
import TicketStatusAdmin from './TicketStatusAdmin';
import TicketTypeAdmin from './TicketTypeAdmin';

/**
 * KbBacklogPage はバックログ画面の container（設計 0・Ⅲ・Ⅵ）。
 *
 * 3 タブ（チケット / 状態 / 種別）を持つ 1 画面。管理はここのタブに置く
 * （設計 Ⅳ-A — スペース設定の画面が存在しないため）。
 */
export default function KbBacklogPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { isOpen: mobilePanelOpen, open: openMobilePanel, close: closeMobilePanel } = useMobilePanelState();

  // 面・アーカイブの切り替え・選択中のチケットは URL に持つ。チケットを開いて戻ったときに
  // 絞り込みと選択が残るようにするため（useBacklogUrlState）。
  const {
    tab,
    archived,
    selectedId,
    statusId,
    typeId,
    labelId,
    unassigned,
    assignedToMe,
    overdue,
    q,
    setTab,
    setArchived,
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

  const { workspaceSlug, space, noSpaces, loading: spaceLoading, error: spaceError } = useBacklogSpace(
    spaceId,
    (id) => navigate(`/kb/backlog/${id}`, { replace: true }),
  );

  const list = useTicketList(workspaceSlug ?? undefined, space?.id, {
    archived,
    statusId: statusId ?? undefined,
    typeId: typeId ?? undefined,
    labelId: labelId ?? undefined,
    unassigned,
    assignedToMe,
    overdue,
    q: q || undefined,
  });
  const masters = useTicketMasters(workspaceSlug ?? undefined, space?.id);
  const labels = useTicketLabels(workspaceSlug ?? undefined, space?.id);
  const { principals, nameOf, initialsOf } = usePrincipalNames(workspaceSlug ?? undefined);

  // スペースを切り替えたら文脈を捨てる（前のスペースのチケットを次の画面で引きずらない）。
  // 初回の読み込みでは捨てない — URL に載っている選択や絞り込みを開いた直後に消してしまう。
  const shownSpace = useRef<string | null>(null);
  useEffect(() => {
    const id = space?.id ?? null;
    if (shownSpace.current !== null && shownSpace.current !== id) reset();
    shownSpace.current = id;
  }, [space?.id, reset]);

  const enabled = !masters.loading && !masters.error && masters.statuses.length > 0;
  const selectedTicket = selectedId ? list.tickets.find((t) => t.id === selectedId) ?? null : null;
  const parentTicket = selectedTicket?.parentId
    ? list.tickets.find((t) => t.id === selectedTicket.parentId)
    : undefined;

  const handleEnable = async () => {
    if (!workspaceSlug || !space) return;
    setEnabling(true);
    try {
      await TicketRepository.enable(workspaceSlug, space.id);
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
      {/* サイドバーは spaceError・noSpaces でも常に描く（KbSidebar 自身が空のワークスペース／
          空のスペース一覧を検知して作成フォームを出す。ここで早期 return して隠すと、
          その抜け道ごと失われる）。 */}
      <SecondaryPanel
        title="バックログ"
        peekable
        storageKey="frestyle.panel.note"
        resizable
        resizeStorageKey="frestyle.panel.note.width"
        mobileOpen={mobilePanelOpen}
        onMobileClose={closeMobilePanel}
      >
        <KbSidebar workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''} />
      </SecondaryPanel>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center border-b border-surface-3 bg-surface-1 px-4 py-2 md:hidden">
          <button type="button" onClick={openMobilePanel} aria-label="バックログを開く" className="p-1">
            <Bars3Icon className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {spaceError ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-[var(--color-text-muted)]">
            {spaceError}
          </div>
        ) : noSpaces ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <p className="mb-1 text-base font-semibold text-[var(--color-text-secondary)]">
                バックログを使えるスペースがありません
              </p>
              <p className="text-sm text-[var(--color-text-muted)]">
                左のサイドバーからワークスペースまたはスペースを作ると使えるようになります。
              </p>
            </div>
          </div>
        ) : spaceLoading || !space ? (
          <div className="flex flex-1 items-center justify-center text-sm text-[var(--color-text-muted)]">
            読み込み中…
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-surface-3 px-4 py-2.5">
              <h1 className="text-sm font-semibold text-[var(--color-text-primary)]">{space.name} のバックログ</h1>
              {tab === 'tickets' && enabled && !list.loading && (
                <span className="text-xs text-[var(--color-text-muted)]">{list.tickets.length} 件</span>
              )}
              {tab === 'tickets' && enabled && (
                <button
                  type="button"
                  onClick={() =>
                    void withToastOnFailure(
                      () => list.createTicket({ title: '無題のチケット' }).then((t) => handleSelect(t.id)),
                      'チケットを作成できませんでした。',
                    )
                  }
                  className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700"
                >
                  チケットを作成
                </button>
              )}
              {tab === 'tickets' && !enabled && !masters.loading && (
                <button
                  type="button"
                  onClick={() => void handleEnable()}
                  disabled={enabling}
                  className="ml-auto rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {enabling ? '有効化中…' : 'チケットを有効化'}
                </button>
              )}
              {tab !== 'tickets' && (
                <span className="ml-auto text-xs text-[var(--color-text-faint)]" />
              )}
            </div>

            <div className="flex items-center gap-1 border-b border-surface-3 px-4">
              <div role="tablist" aria-label="バックログの面" className="flex items-center gap-1">
                {(
                  [
                    ['tickets', 'チケット'],
                    ['statuses', '状態'],
                    ['types', '種別'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`border-b-2 px-2.5 py-2 text-sm font-medium transition-colors ${
                      tab === value
                        ? 'border-brand-600 text-brand-700'
                        : 'border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {tab === 'tickets' && enabled && (
                <span className="ml-auto flex gap-1 py-1.5">
                  <button
                    type="button"
                    aria-pressed={!archived}
                    onClick={() => setArchived(false)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      !archived ? 'bg-surface-3 text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:bg-surface-2'
                    }`}
                  >
                    現役
                  </button>
                  <button
                    type="button"
                    aria-pressed={archived}
                    onClick={() => setArchived(true)}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      archived ? 'bg-surface-3 text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)] hover:bg-surface-2'
                    }`}
                  >
                    アーカイブ
                  </button>
                </span>
              )}
            </div>

            {tab === 'tickets' && enabled && (
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

            <div className="min-h-0 flex-1" role="tabpanel">
              {tab === 'tickets' &&
                (!enabled && !masters.loading ? (
                  <div className="flex h-full items-center justify-center px-6 text-center">
                    <div>
                      <p className="mb-1 text-base font-semibold text-[var(--color-text-secondary)]">
                        このスペースではチケットを使っていません
                      </p>
                      <p className="text-sm text-[var(--color-text-muted)]">
                        有効化すると、状態 5 件と種別 3 件の雛形が入ります。あとから増やせます。
                      </p>
                    </div>
                  </div>
                ) : (
                  <BacklogList
                    tickets={list.tickets}
                    statuses={masters.statuses}
                    types={masters.types}
                    spaceKey={space.key}
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
                    onMove={(id, input) => list.move(id, input)}
                    onRetry={list.refresh}
                  />
                ))}

              {tab === 'statuses' && (
                <div className="p-4">
                  <TicketStatusAdmin
                    statuses={masters.statuses}
                    onCreate={masters.createStatus}
                    onSetInitial={masters.setInitialStatus}
                    onArchive={masters.archiveStatus}
                  />
                </div>
              )}

              {tab === 'types' && (
                <div className="p-4">
                  <TicketTypeAdmin
                    types={masters.types}
                    onCreate={masters.createType}
                    onSetDefault={masters.setDefaultType}
                    onArchive={masters.archiveType}
                  />
                </div>
              )}
            </div>
          </>
        )}
      </main>

      {tab === 'tickets' && selectedTicket && (
        <SecondaryPanel
          title="詳細"
          side="right"
          resizable
          resizeStorageKey="frestyle.panel.ticket-detail.width"
          defaultWidth={420}
          mobileOpen={detailMobileOpen}
          onMobileClose={() => setDetailMobileOpen(false)}
          headerContent={
            <div className="flex items-center gap-3">
              <Link
                to={`/kb/tickets/${selectedTicket.id}`}
                className="text-xs font-medium text-brand-700 hover:underline"
              >
                全画面で開く
              </Link>
              <button
                type="button"
                onClick={() => selectTicket(null)}
                className="ml-auto text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
              >
                詳細を閉じる
              </button>
            </div>
          }
        >
          <TicketDetailPanel
            key={selectedTicket.id}
            ticket={selectedTicket}
            spaceKey={space?.key ?? ''}
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
