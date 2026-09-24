import { Link, useLocation } from 'react-router-dom';
import { AutoResizeTextarea, FsIcon, PageFrame } from '@/shared/ui';
import { useMediaQuery } from '@/shared/lib/hooks/useMediaQuery';
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
import { emptyRichDoc, isRichDoc } from '@/shared/ui/RichTextEditor';
import TicketDescriptionEditor from './TicketDescriptionEditor';
import { useTicketEditor } from '../model/useTicketEditor';
import { useTicketFieldWrites } from '../model/useTicketFieldWrites';
import { ticketReturnPath } from '../lib/ticketReturnPath';
import { buildAttributeFeedback } from './attributeFeedback';
import FieldFeedback from './FieldFeedback';
import TicketSaveBadge from './TicketSaveBadge';
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
  /**
   * 状態・担当・ラベル・親の書き換え。失敗は投げ返すこと（結果は票が項目のすぐ下に出すので、
   * 呼び出し側はトーストを重ねない）。
   */
  onChangeStatus: (statusId: string) => Promise<unknown>;
  onAssign: (principalId: string) => Promise<unknown>;
  onUnassign: () => Promise<unknown>;
  onArchive: () => void;
  onRestore: () => void;
  /** attached は押す前に付いていたか（付いていれば外す）。 */
  onToggleLabel: (label: Label, attached: boolean) => Promise<unknown>;
  onCreateLabel: (name: string, color: string) => Promise<Label>;
  onChangeParent: (parentId: string | null) => Promise<unknown>;
  /** 結果が分からない失敗のあとの「最新を確認」。このチケットを取り直す。 */
  onRefresh?: () => void;
}

/**
 * チケットを開いた全画面の票。
 *
 * 広い画面（1280px 以上）は本文の列と右の副列（詳細情報・添付・変更履歴・操作）。
 * 狭い画面は 1 列で、設計ボード ST13 の順（題名 → 状態 → 説明 → 詳細情報 → 添付・サブタスク →
 * コメント）。直す項目をコメントの後ろに置くと、長いやり取りのあるチケットでは届かない。
 * 詳細情報は画面幅でどちらか片方にだけ描く（同じ項目を 2 か所に描くと、下書きが二重になる）。
 *
 * 上の「戻る」は開いた一覧へ条件ごと戻る（PX03。自分の担当から来たら「自分の担当に戻る」）。
 * 状態・担当・ラベル・親・優先度・日付を変えた結果は、その項目のすぐ下に出す（PX04）。
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
  onRefresh,
}: TicketFullViewProps) {
  const location = useLocation();
  const wide = useMediaQuery('(min-width: 1280px)');
  const type = types.find((t) => t.id === ticket.typeId);
  const archived = ticket.archivedAt !== null;
  const parentTicket = ancestors.length > 0 ? ancestors[ancestors.length - 1] : undefined;
  const back = ticketReturnPath((location.state as { from?: unknown } | null)?.from, ticket.projectId, ticket.id);

  // 版・チーム（プロジェクトの語彙）と、このチケットに付いている分・所属スプリント。
  const vocabulary = useTicketVocabulary(workspaceSlug, ticket.projectId, ticket.id, ticket.teamId);
  const editor = useTicketEditor(ticket, canEdit && !archived, onUpdate);
  const writes = useTicketFieldWrites(statuses, {
    changeStatus: onChangeStatus,
    assign: onAssign,
    unassign: onUnassign,
    toggleLabel: onToggleLabel,
    changeParent: onChangeParent,
  });
  const docValue = isRichDoc(editor.doc) ? editor.doc : emptyRichDoc();

  const attributes = (
    <TicketSection title="詳細情報" headingLevel={2}>
      <TicketAttributePanel
        columns={wide ? 1 : 2}
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
        onToggleLabel={(label) => void writes.toggleLabel(label, ticket.labels.some((l) => l.id === label.id))}
        onCreateLabel={onCreateLabel}
        onAssign={(principalId) => void writes.assign(principalId)}
        onUnassign={() => void writes.unassign()}
        onChangePriority={editor.changePriority}
        onChangeStoryPoints={editor.changeStoryPoints}
        onChangeStartDate={editor.changeStartDate}
        onChangeDueDate={editor.changeDueDate}
        onChangeParent={(parentId) => void writes.changeParent(parentId)}
        feedback={buildAttributeFeedback(editor.outcomeOf, writes.outcomeOf, onRefresh)}
      />
    </TicketSection>
  );

  // 添付とサブタスクは詳細パネルと同じ規則: 無いことの方が多いので畳み、件数を見出しに出す。
  const attachments = (
    <TicketSection title="添付" headingLevel={2} collapsible>
      <TicketAttachmentSection workspaceSlug={workspaceSlug} ticketId={ticket.id} canEdit={canEdit && !archived} />
    </TicketSection>
  );
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
                className="min-h-12 w-full rounded-md border border-transparent bg-transparent px-1 text-2xl font-bold text-[var(--color-text-primary)] hover:border-surface-3 focus:outline-none focus:ring-2 focus:ring-brand-600"
              />
              <FieldFeedback outcome={editor.outcomeOf('title')} onVerify={onRefresh} className="mt-1" />
              <div className="mb-5" />
              </>
            ) : (
              <h1 className="mb-3 text-xl font-semibold text-[var(--color-text-primary)]">{ticket.title}</h1>
            )}

            <TicketSection title="説明" headingLevel={2}>
              <TicketDescriptionEditor value={docValue} editable={canEdit && !archived} onSave={editor.saveDoc} />
            </TicketSection>

            {/* 狭い画面は、直す項目を説明のすぐ後に（ST13）。広い画面は右の副列。 */}
            {!wide && attributes}
            {!wide && attachments}

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
          to={back.to}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-sm text-[var(--color-text-muted)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <FsIcon name="chevron-left" className="h-4 w-4" />
          {back.label}
        </Link>
        <TicketAncestorTrail ancestors={ancestors} projectKey={projectKey} />
        <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-semibold text-[var(--color-text-secondary)]">
          {type?.name ?? ''}
        </span>
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} />
        <TicketStatusSelect
          statuses={statuses}
          statusId={ticket.statusId}
          canEdit={canEdit && !archived}
          busy={busy || writes.outcomeOf('status')?.kind === 'saving'}
          onChange={(statusId) => void writes.changeStatus(statusId)}
        />
        <div className="ml-auto">
          {canEdit && !archived && <TicketSaveBadge status={editor.saveStatus} />}
        </div>
        {/* 状態を変えた結果は選択欄の並びのすぐ下に（PX04）。 */}
        <FieldFeedback outcome={writes.outcomeOf('status')} onVerify={onRefresh} className="w-full" />
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
        {/* 副列。広い画面だけ右に並ぶ（狭い画面では詳細情報と添付を本文の列へ移し、ここは履歴と操作だけ）。 */}
        <aside aria-label="チケットの詳細" className="min-w-0 rounded-xl border border-surface-3 bg-surface-1 p-4 sm:p-5 xl:sticky xl:top-6">
          {wide && <div className="min-w-0">{attributes}</div>}
          {wide && <div className="min-w-0">{attachments}</div>}

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
