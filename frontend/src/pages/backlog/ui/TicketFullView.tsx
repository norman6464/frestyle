import { Link } from 'react-router-dom';
import { AutoResizeTextarea, FsIcon, PageFrame } from '@/shared/ui';
import {
  TicketKeyBadge,
  type Label,
  type Ticket,
  type TicketChangeGroup,
  type TicketStatus,
  type TicketType,
  type UpdateTicketInput,
} from '@/entities/ticket';
import type { KbGrantablePrincipal } from '@/entities/kb';
import { SaveStatusIndicator, emptyRichDoc, isRichDoc } from '@/shared/ui/RichTextEditor';
import TicketDescriptionEditor from './TicketDescriptionEditor';
import { useTicketEditor } from '../model/useTicketEditor';
import TicketAncestorTrail from './TicketAncestorTrail';
import TicketAttachmentSection from './TicketAttachmentSection';
import TicketAttributePanel from './TicketAttributePanel';
import TicketChangeHistory from './TicketChangeHistory';
import TicketChildrenSection from './TicketChildrenSection';
import TicketCommentSection from './TicketCommentSection';
import TicketSection from './TicketSection';
import { useTicketVocabulary } from '../model/useTicketVocabulary';
import TicketStatusSelect from './TicketStatusSelect';

export interface TicketFullViewProps {
  ticket: Ticket;
  ancestors: Ticket[];
  projectKey: string;
  workspaceSlug: string;
  statuses: TicketStatus[];
  types: TicketType[];
  principals: KbGrantablePrincipal[];
  history: TicketChangeGroup[];
  historyLoading: boolean;
  historyError: string | null;
  canEdit: boolean;
  busy: boolean;
  allLabels: Label[];
  onUpdate: (input: UpdateTicketInput) => Promise<Ticket>;
  onChangeStatus: (statusId: string) => void;
  onAssign: (principalId: string) => void;
  onUnassign: () => void;
  onArchive: () => void;
  onRestore: () => void;
  onToggleLabel: (label: Label) => void;
  onCreateLabel: (name: string, color: string) => Promise<Label>;
  onChangeParent: (parentId: string | null) => void;
}

/**
 * チケットを開いた全画面の票。
 *
 * 本文と詳細情報を同じスクロール領域に置き、画面幅に合わせて並べる。
 * 広い画面では右列に属性、狭い画面では本文の前に担当と期限の概要を出す。
 *
 * 狭い幅では本文→詳細情報の順。状態変更は上部に置くので本文を読み終えなくても使える。
 * 幅によらず DOM は1つだけで、読み上げと見た目の順序を揃える。
 */
export default function TicketFullView({
  ticket,
  ancestors,
  projectKey,
  workspaceSlug,
  statuses,
  types,
  principals,
  history,
  historyLoading,
  historyError,
  canEdit,
  busy,
  allLabels,
  onUpdate,
  onChangeStatus,
  onAssign,
  onUnassign,
  onArchive,
  onRestore,
  onToggleLabel,
  onCreateLabel,
  onChangeParent,
}: TicketFullViewProps) {
  const type = types.find((t) => t.id === ticket.typeId);
  const archived = ticket.archivedAt !== null;
  const parentTicket = ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined;

  // 版・チーム（プロジェクトの語彙）と、このチケットに付いている分・所属スプリント。
  const vocabulary = useTicketVocabulary(workspaceSlug, ticket.projectId, ticket.id, ticket.teamId);
  const editor = useTicketEditor(ticket, canEdit && !archived, onUpdate);
  const docValue = isRichDoc(editor.doc) ? editor.doc : emptyRichDoc();
  // 見た目だけでなく、読み上げ・Tab の順も本文を先にする。
  const mainContent = (
        <div className="min-w-0 max-w-3xl">
          <div className="w-full">
            {canEdit && !archived ? (
              <>
              <h1 className="sr-only">{editor.title || 'チケット'}</h1>
              <label className="mb-2 block text-xs text-[var(--color-text-muted)]" htmlFor="ticket-title">題名 · 入力後に自動保存</label>
              <AutoResizeTextarea
                id="ticket-title"
                value={editor.title}
                onChange={(e) => editor.changeTitle(e.target.value.replace(/[\r\n]+/g, ' '))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
                onBlur={editor.commitTitle}
                aria-label="題名"
                className="mb-5 min-h-12 w-full rounded-md border border-transparent bg-transparent px-1 text-2xl font-bold text-[var(--color-text-primary)] hover:border-surface-3 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              </>
            ) : (
              <h1 className="mb-3 text-xl font-semibold text-[var(--color-text-primary)]">{ticket.title}</h1>
            )}

            <dl className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-surface-3 bg-surface-2 p-4 text-sm xl:hidden">
              <div><dt className="text-xs text-[var(--color-text-muted)]">担当者</dt><dd className="mt-1 font-medium [overflow-wrap:anywhere]">{principals.find((p) => p.id === ticket.assigneePrincipalId)?.name || '未割り当て'}</dd></div>
              <div><dt className="text-xs text-[var(--color-text-muted)]">期限</dt><dd className="mt-1 font-medium">{editor.dueDate || '未設定'}</dd></div>
            </dl>
            <TicketSection title="説明" headingLevel={2}>
              <TicketDescriptionEditor value={docValue} editable={canEdit && !archived} onSave={editor.saveDoc} />
            </TicketSection>

            <TicketSection title="サブタスク" headingLevel={2} collapsible>
              <TicketChildrenSection workspaceSlug={workspaceSlug} ticketId={ticket.id} projectKey={projectKey} statuses={statuses} />
            </TicketSection>

            <TicketSection title="コメント" headingLevel={2}>
              <TicketCommentSection workspaceSlug={workspaceSlug} ticketId={ticket.id} />
            </TicketSection>
          </div>
        </div>
  );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-2 border-b border-surface-3 px-4 py-3 md:px-6">
        {/* 戻り先には今のチケットを載せる。一覧に戻ったとき、このチケットが選ばれた状態で
            開き、詳細パネルも出る。素の /backlog/:projectId へ戻すと選択が消えて、
            一覧の中からもう一度探すことになる。 */}
        <Link
          to={`/backlog/${ticket.projectId}?ticket=${encodeURIComponent(ticket.id)}`}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-[var(--color-text-muted)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <FsIcon name="chevron-left" className="h-4 w-4" />
          バックログ
        </Link>
        <TicketAncestorTrail ancestors={ancestors} projectKey={projectKey} />
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
          {type?.name ?? ''}
        </span>
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} />
        <TicketStatusSelect statuses={statuses} statusId={ticket.statusId} canEdit={canEdit && !archived} busy={busy} onChange={onChangeStatus} />
        <div className="ml-auto">
          <SaveStatusIndicator status={editor.saveStatus} />
        </div>
      </header>

      {archived && (
        <p className="flex-none border-b border-surface-3 bg-surface-2 px-4 py-1.5 text-xs text-[var(--color-text-secondary)] md:px-6">
          このチケットはアーカイブされています
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        <PageFrame>
        <div className="grid items-start gap-8 xl:grid-cols-[minmax(0,1fr)_18rem] xl:gap-10">
        {mainContent}
        {/* 副列。狭い幅では本文に続き、広い幅では右側に並ぶ。 */}
        <aside aria-label="チケットの詳細" className="min-w-0 rounded-xl border border-surface-3 bg-surface-1 p-4 sm:p-5 xl:sticky xl:top-6">
          <div className="min-w-0">
            <TicketSection title="詳細情報" headingLevel={2}>
              <TicketAttributePanel
                columns={1}
                ticket={ticket}
                workspaceSlug={workspaceSlug}
                projectKey={projectKey}
                principals={principals}
                parentTicket={parentTicket}
                canEdit={canEdit}
                archived={archived}
                busy={busy}
                priority={editor.priority}
                storyPoints={editor.storyPoints}
                startDate={editor.startDate}
                dueDate={editor.dueDate}
                versions={vocabulary.versions}
                teams={vocabulary.teams}
                fixVersions={vocabulary.fixVersions}
                sprint={vocabulary.sprint}
                teamId={vocabulary.teamId}
                onSetFixVersion={(versionId, attach) => void vocabulary.setFixVersion(versionId, attach)}
                onChangeTeam={(next) => void vocabulary.changeTeam(next)}
                allLabels={allLabels}
                onToggleLabel={onToggleLabel}
                onCreateLabel={onCreateLabel}
                onAssign={onAssign}
                onUnassign={onUnassign}
                onChangePriority={editor.changePriority}
                onChangeStoryPoints={editor.changeStoryPoints}
                onChangeStartDate={editor.changeStartDate}
                onChangeDueDate={editor.changeDueDate}
                onChangeParent={onChangeParent}
              />
            </TicketSection>

          </div>

          <div className="min-w-0">
            <TicketSection title="添付ファイル" headingLevel={2} collapsible>
              <TicketAttachmentSection workspaceSlug={workspaceSlug} ticketId={ticket.id} canEdit={canEdit && !archived} />
            </TicketSection>
          </div>

          <div className="min-w-0">
            <TicketSection title="変更履歴" headingLevel={2} collapsible defaultOpen={false}>
              <TicketChangeHistory history={history} loading={historyLoading} error={historyError} />
            </TicketSection>

            {canEdit && (
              <TicketSection title="操作" headingLevel={2}>
                <button
                  type="button"
                  onClick={() => (archived ? onRestore() : onArchive())}
                  disabled={busy}
                  className="min-h-11 rounded-md border border-surface-3 px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
                >
                  {archived ? '現役に戻す' : 'アーカイブ'}
                </button>
              </TicketSection>
            )}
          </div>
        </aside>
        </div>
        </PageFrame>
      </div>
    </div>
  );
}
