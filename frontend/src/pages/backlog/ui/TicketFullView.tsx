import { Link } from 'react-router-dom';
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
import Loading from '@/shared/ui/Loading';
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
 * 主列（題名・ラベル・本文）と副列（素性・変更履歴・操作）を**別々にスクロール**させる。
 * 長い議論を追いながら状態・担当・期限が視界から消えないのが、細いパネルではなく
 * 全画面にする実利。
 *
 * 狭い幅では 1 欄に畳み、**素性を本文より前**に出す（外出先で状態や期限だけ直したいときに、
 * 本文を全部スクロールし切らせない）。副列の中身は `display:contents` で外側の並びへ
 * 溶かし、狭い幅と広い幅で**同じ DOM を 1 度だけ**描く（2 通りを同時に描くと、
 * 同じ操作が 2 つ現れて読み上げでも見分けが付かなくなる）。
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-2 border-b border-surface-3 px-4 py-3 md:px-6">
        <Link
          to={`/backlog/${ticket.projectId}`}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:underline"
        >
          ◂ バックログ
        </Link>
        <TicketAncestorTrail ancestors={ancestors} projectKey={projectKey} />
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--color-text-secondary)]">
          {type?.name ?? ''}
        </span>
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} />
        <div className="ml-auto">
          <SaveStatusIndicator status={editor.saveStatus} />
        </div>
      </header>

      {archived && (
        <p className="flex-none border-b border-surface-3 bg-surface-2 px-4 py-1.5 text-xs text-[var(--color-text-secondary)] md:px-6">
          このチケットはアーカイブされています
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* 副列。狭い幅では contents で外側の並びへ溶け、素性が本文の前・履歴が後ろに来る。 */}
        <div className="contents lg:flex lg:w-[19rem] lg:flex-none lg:flex-col lg:overflow-y-auto lg:border-l lg:border-surface-3 lg:px-4 lg:py-5">
          <div className="order-1 px-4 pt-4 lg:order-none lg:p-0">
            <TicketSection title="素性">
              <TicketAttributePanel
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

            <TicketSection title="子">
              <TicketChildrenSection workspaceSlug={workspaceSlug} ticketId={ticket.id} projectKey={projectKey} statuses={statuses} />
            </TicketSection>
          </div>

          <div className="order-3 px-4 pb-4 lg:order-none lg:p-0">
            <TicketSection title="添付">
              <TicketAttachmentSection workspaceSlug={workspaceSlug} ticketId={ticket.id} canEdit={canEdit && !archived} />
            </TicketSection>
          </div>

          <div className="order-4 px-4 pb-6 lg:order-none lg:p-0">
            <TicketSection title="変更履歴">
              <TicketChangeHistory history={history} loading={historyLoading} error={historyError} />
            </TicketSection>

            {canEdit && (
              <TicketSection title="操作">
                <button
                  type="button"
                  onClick={() => (archived ? onRestore() : onArchive())}
                  disabled={busy}
                  className="rounded border border-surface-3 px-2.5 py-1 text-xs font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:opacity-50"
                >
                  {archived ? '現役に戻す' : 'アーカイブ'}
                </button>
              </TicketSection>
            )}
          </div>
        </div>

        {/* 主列。 */}
        <div className="order-2 min-w-0 flex-1 px-4 py-4 lg:order-none lg:overflow-y-auto lg:px-6 lg:py-5" tabIndex={0}>
          <div className="mx-auto w-full max-w-[46rem]">
            {canEdit && !archived ? (
              <input
                type="text"
                value={editor.title}
                onChange={(e) => editor.changeTitle(e.target.value)}
                onBlur={editor.commitTitle}
                aria-label="題名"
                className="mb-3 w-full bg-transparent text-xl font-semibold text-[var(--color-text-primary)] focus:outline-none"
              />
            ) : (
              <h1 className="mb-3 text-xl font-semibold text-[var(--color-text-primary)]">{ticket.title}</h1>
            )}

            <TicketSection title="説明">
              <TicketDescriptionEditor value={docValue} editable={canEdit && !archived} onSave={editor.saveDoc} />
            </TicketSection>

            <TicketSection title="コメント">
              <TicketCommentSection workspaceSlug={workspaceSlug} ticketId={ticket.id} />
            </TicketSection>
          </div>
        </div>
      </div>
    </div>
  );
}
