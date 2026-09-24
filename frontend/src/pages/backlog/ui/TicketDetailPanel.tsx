import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AutoResizeTextarea } from '@/shared/ui';
import {
  formatTicketKey,
  type Label,
  type Ticket,
  type TicketStatus,
  type TicketType,
  type UpdateTicketInput,
} from '@/entities/ticket';
import type { KbGrantablePrincipal } from '@/entities/kb';
import { emptyRichDoc, isRichDoc } from '@/shared/ui/RichTextEditor';
import { useTicketEditor } from '../model/useTicketEditor';
import TicketAttachmentSection from './TicketAttachmentSection';
import TicketAttributePanel from './TicketAttributePanel';
import TicketChildrenSection from './TicketChildrenSection';
import TicketCommentSection from './TicketCommentSection';
import TicketDescriptionEditor from './TicketDescriptionEditor';
import TicketSection from './TicketSection';
import { useTicketVocabulary } from '../model/useTicketVocabulary';
import TicketStatusSelect from './TicketStatusSelect';
import TicketWatchButton from './TicketWatchButton';
import { formatTicketTimestamp } from '../lib/formatTicketTimestamp';

export interface TicketDetailPanelProps {
  ticket: Ticket;
  projectKey: string;
  workspaceSlug: string;
  statuses: TicketStatus[];
  types: TicketType[];
  principals: KbGrantablePrincipal[];
  parentTicket: Ticket | undefined;
  canEdit: boolean;
  busy: boolean;
  allLabels: Label[];
  onUpdate: (ticketId: string, input: UpdateTicketInput) => Promise<Ticket>;
  onChangeStatus: (statusId: string) => Promise<void>;
  onAssign: (principalId: string) => Promise<void>;
  onUnassign: () => Promise<void>;
  onArchive: () => Promise<void>;
  onRestore: () => Promise<void>;
  onToggleLabel: (label: Label) => void;
  onCreateLabel: (name: string, color: string) => Promise<Label>;
  onChangeParent: (parentId: string | null) => Promise<void>;
}

/**
 * チケット詳細パネル。一覧を捌きながら 1 件を確かめ、軽く直すための面（設計ボード ST11）。
 *
 * 上から順に、身元（キーと種別）→ 題名 → 状態と所属 → 説明 → 基本の 4 項目 → その他 7 項目 →
 * 添付・サブタスク → コメント。読む順と、直す頻度の順を揃えてある。
 *
 * 見出し（「選択中 KEY」）と選択解除は器（広い画面は TicketDetailPane の帯、狭い画面は
 * TicketDetailSheet）が描く。ここで同じ見出しをもう 1 行出すと二重になるので持たない。
 * スクロールもフォーカスの止まり先も器が持つので、この根の要素は tabIndex を持たない
 * （名前の無い入れ物が Tab で止まると、読み上げには何なのか分からない）。
 */
export default function TicketDetailPanel({
  ticket,
  projectKey,
  workspaceSlug,
  statuses,
  types,
  principals,
  parentTicket,
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
}: TicketDetailPanelProps) {
  const archived = ticket.archivedAt !== null;
  const editable = canEdit && !archived;

  const type = types.find((t) => t.id === ticket.typeId);
  // 版・チーム（プロジェクトの語彙）と、このチケットに付いている分・所属スプリント。
  const vocabulary = useTicketVocabulary(workspaceSlug, ticket.projectId, ticket.id, ticket.teamId);
  const editor = useTicketEditor(ticket, editable, (input) => onUpdate(ticket.id, input));
  // 添付とサブタスクの件数。数えるのは各節の中（自前の取得を持つ）なので、報告を受けて見出しへ回す。
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [childCount, setChildCount] = useState<number | null>(null);
  const docValue = isRichDoc(editor.doc) ? editor.doc : emptyRichDoc();
  const key = formatTicketKey(projectKey, ticket.number);

  return (
    // スクロールは器（TicketDetailPane / TicketDetailSheet の中身ラッパー）が持つ。ここに
    // overflow-y-auto を付けると「スクロール範囲ゼロの空の容器」になり、overscroll-contain と
    // 相まってホイール操作を飲み込んで器までスクロールが届かなくなる（実測で確認）。
    <div className="px-4 py-5 sm:px-5">
      {/* 身元。キーと種別を 1 行に。押すと全画面で開く（同じ物を大きく見る操作なので、身元そのものを入口にする）。 */}
      <Link
        to={`/tickets/${ticket.id}`}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-md font-mono text-xs font-semibold tracking-wide text-brand-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <span>{key}</span>
        {type && (
          <>
            <span aria-hidden="true" className="text-[var(--color-text-faint)]">・</span>
            <span className="font-sans font-medium">{type.name}</span>
          </>
        )}
      </Link>

      {editable ? (
        <AutoResizeTextarea
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
          className="-mx-1 mt-1 mb-3 min-h-12 w-[calc(100%+0.5rem)] rounded-md border border-transparent bg-transparent px-1 text-xl font-bold leading-snug text-[var(--color-text-primary)] hover:border-surface-3 focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      ) : (
        <h2 className="mt-1 mb-3 text-xl font-bold leading-snug text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{ticket.title}</h2>
      )}

      {/* 状態と所属。状態はいちばん押す物なので題名の直下に置く。所属（スプリントかバックログか）は読むだけ。 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TicketStatusSelect
          statuses={statuses}
          statusId={ticket.statusId}
          canEdit={editable}
          busy={busy}
          onChange={(statusId) => void onChangeStatus(statusId)}
        />
        <span className="text-sm text-[var(--color-text-muted)]">{vocabulary.sprint?.name ?? 'バックログ'}</span>
        <div className="ml-auto">
          <TicketWatchButton workspaceSlug={workspaceSlug} ticketId={ticket.id} />
        </div>
      </div>

      <TicketSection title="説明">
        <TicketDescriptionEditor value={docValue} editable={editable} onSave={editor.saveDoc} />
      </TicketSection>

      <div className="mb-5 border-t border-surface-3 pt-4">
        <TicketAttributePanel
          columns={2}
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
          onAssign={(principalId) => void onAssign(principalId)}
          onUnassign={() => void onUnassign()}
          onChangePriority={editor.changePriority}
          onChangeStoryPoints={editor.changeStoryPoints}
          onChangeStartDate={editor.changeStartDate}
          onChangeDueDate={editor.changeDueDate}
          onChangeParent={(parentId) => void onChangeParent(parentId)}
        />
      </div>

      {/* 添付とサブタスクは「無いことの方が多い」節。中身は載せたまま畳んでおき、件数だけ
          見出しに出す。開かずとも 0 と分かるので、空の説明文で縦を食わずに済む。 */}
      <div className="border-t border-surface-3 pt-4">
        <TicketSection
          title="添付"
          collapsible
          mountWhenClosed
          count={attachmentCount ?? undefined}
          defaultOpen={false}
          key={`attachments-${ticket.id}`}
        >
          <TicketAttachmentSection
            workspaceSlug={workspaceSlug}
            ticketId={ticket.id}
            canEdit={editable}
            onCountChange={setAttachmentCount}
          />
        </TicketSection>

        <TicketSection
          title="サブタスク"
          collapsible
          mountWhenClosed
          count={childCount ?? undefined}
          defaultOpen={false}
          key={`children-${ticket.id}`}
        >
          <TicketChildrenSection
            workspaceSlug={workspaceSlug}
            ticketId={ticket.id}
            projectKey={projectKey}
            statuses={statuses}
            onCountChange={setChildCount}
          />
        </TicketSection>
      </div>

      <div className="border-t border-surface-3 pt-4">
        <TicketSection title="コメント">
          <TicketCommentSection workspaceSlug={workspaceSlug} ticketId={ticket.id} compact />
        </TicketSection>
      </div>

      {/* 作成・更新と、チケットそのものへの操作はどの項目より後ろ。読む順の最後に来るのが自然。 */}
      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-surface-3 pt-4">
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          作成 {formatTicketTimestamp(ticket.createdAt)}
          <br />
          更新 {formatTicketTimestamp(ticket.updatedAt)}
        </p>
        {canEdit && (
          <button
            type="button"
            onClick={() => void (archived ? onRestore() : onArchive())}
            disabled={busy}
            className="min-h-9 rounded-md border border-surface-3 px-3 text-xs font-medium text-[var(--color-text-secondary)] transition-colors duration-fast hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50 [@media(pointer:coarse)]:min-h-11"
          >
            {archived ? '現役に戻す' : 'アーカイブ'}
          </button>
        )}
      </div>
    </div>
  );
}
