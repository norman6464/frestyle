import { useState } from 'react';
import { AutoResizeTextarea } from '@/shared/ui';
import {
  TicketKeyBadge,
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
 * チケット詳細パネル。一覧を捌きながら 1 件を確かめ、軽く直すための面。
 *
 * 見出しと閉じるボタンは器（SecondaryPanel）が描く。ここで同じ見出しをもう 1 行出すと
 * 二重になるので持たない。保存状態は「本文」の節の見出しに添える。
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

  const type = types.find((t) => t.id === ticket.typeId);
  // 版・チーム（プロジェクトの語彙）と、このチケットに付いている分・所属スプリント。
  const vocabulary = useTicketVocabulary(workspaceSlug, ticket.projectId, ticket.id, ticket.teamId);
  const editor = useTicketEditor(ticket, canEdit && !archived, (input) => onUpdate(ticket.id, input));
  // 添付とサブタスクの件数。数えるのは各節の中（自前の取得を持つ）なので、報告を受けて見出しへ回す。
  const [attachmentCount, setAttachmentCount] = useState<number | null>(null);
  const [childCount, setChildCount] = useState<number | null>(null);
  const docValue = isRichDoc(editor.doc) ? editor.doc : emptyRichDoc();

  return (
    // スクロールは器（SecondaryPanel の中身ラッパー）が持つ。ここに overflow-y-auto を
    // 付けると「スクロール範囲ゼロの空の容器」になり、overscroll-contain と相まって
    // ホイール操作を飲み込んで器までスクロールが届かなくなる（実測で確認）。
    // flex-1 / min-h-0 も親が flex コンテナではないため効かない。素の中身として置く。
    <div className="px-4 py-5" tabIndex={0}>
      {/* 先頭行（パンくず）。親とキーで「どのチケットか」を示す（設計 13）。
          器の見出しは「チケット」のままなので、身元はここが唯一の出どころになる。 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-[var(--color-text-muted)]">
        {parentTicket ? (
          <>
            <span className="truncate">{parentTicket.title}</span>
            <span className="text-[var(--color-text-faint)]">/</span>
          </>
        ) : (
          <>
            <span>親なし</span>
            <span className="text-[var(--color-text-faint)]">/</span>
          </>
        )}
        <TicketKeyBadge projectKey={projectKey} number={ticket.number} />
        <span className="rounded bg-surface-2 px-1.5 py-0.5 font-semibold text-[var(--color-text-secondary)]">
          {type?.name ?? ''}
        </span>
      </div>

      {canEdit && !archived ? (
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
          className="mb-4 min-h-12 w-full rounded-md border border-transparent bg-transparent px-1 text-lg font-bold leading-snug text-[var(--color-text-primary)] hover:border-surface-3 focus:outline-none focus:ring-2 focus:ring-brand-600"
        />
      ) : (
        <h2 className="mb-4 text-lg font-bold leading-snug text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{ticket.title}</h2>
      )}

      {/* 状態の変更と、チケットそのものへの操作。題名のすぐ下に置く（設計 12 の並び）。 */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <TicketWatchButton workspaceSlug={workspaceSlug} ticketId={ticket.id} />
        <TicketStatusSelect
          statuses={statuses}
          statusId={ticket.statusId}
          canEdit={canEdit && !archived}
          busy={busy}
          onChange={(statusId) => void onChangeStatus(statusId)}
        />
        {canEdit && (
          <button
            type="button"
            onClick={() => void (archived ? onRestore() : onArchive())}
            disabled={busy}
            className="min-h-11 rounded-md border border-surface-3 px-3 py-2 text-sm font-medium text-[var(--color-text-secondary)] transition-colors hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
          >
            {archived ? '現役に戻す' : 'アーカイブ'}
          </button>
        )}
      </div>

      <TicketSection title="説明" collapsible>
        <TicketDescriptionEditor value={docValue} editable={canEdit && !archived} onSave={editor.saveDoc} />
      </TicketSection>

      {/* 添付とサブタスクは「無いことの方が多い」節。中身は載せたまま畳んでおき、件数だけ
          見出しに出す。開かずとも 0 と分かるので、空の説明文で縦を食わずに済む。
          件数が入ったら開いた状態で始める（有るものを隠さない）。 */}
      <TicketSection
        title="添付ファイル"
        collapsible
        mountWhenClosed
        count={attachmentCount ?? undefined}
        defaultOpen={false}
        key={`attachments-${ticket.id}`}
      >
        <TicketAttachmentSection
          workspaceSlug={workspaceSlug}
          ticketId={ticket.id}
          canEdit={canEdit && !archived}
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

      <TicketSection title="詳細" collapsible>
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
          onAssign={(principalId) => void onAssign(principalId)}
          onUnassign={() => void onUnassign()}
          onChangePriority={editor.changePriority}
          onChangeStoryPoints={editor.changeStoryPoints}
          onChangeStartDate={editor.changeStartDate}
          onChangeDueDate={editor.changeDueDate}
          onChangeParent={(parentId) => void onChangeParent(parentId)}
        />
      </TicketSection>

      {/* 作成・更新はどの項目より後ろ。読む順の最後に来るのが自然（設計 15）。 */}
      <p className="mb-5 text-[11px] leading-relaxed text-[var(--color-text-muted)]">
        作成日 {formatTicketTimestamp(ticket.createdAt)}
        <br />
        更新日 {formatTicketTimestamp(ticket.updatedAt)}
      </p>

      <TicketSection title="アクティビティ">
        <TicketCommentSection workspaceSlug={workspaceSlug} ticketId={ticket.id} compact />
      </TicketSection>
    </div>
  );
}
