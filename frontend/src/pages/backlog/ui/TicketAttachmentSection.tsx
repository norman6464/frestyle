import { useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { useToast } from '@/shared/lib/hooks/useToast';
import { getApiError } from '@/shared/lib/classifyApiError';
import { useTicketAttachments } from '../model/useTicketAttachments';
import { ACCEPTED_ATTACHMENT_ACCEPT_ATTR } from '../config/attachmentUpload';
import TicketAttachmentRow from './TicketAttachmentRow';
import TicketPendingAttachmentRow from './TicketPendingAttachmentRow';
import { EmptyNotice, ErrorNotice, FsIcon, Loading } from '@/shared/ui';

export interface TicketAttachmentSectionProps {
  workspaceSlug: string;
  ticketId: string;
  canEdit: boolean;
}

/**
 * TicketAttachmentSection は添付の一式（取得・追加・削除）をまとめる。
 *
 * 全画面の副列とバックログの副パネルの両方から使う（互いに同時マウントされない別ルート
 * なので、それぞれが自分の useTicketAttachments を持ってよい。TicketCommentSection と同じ
 * 考え方）。
 */
export default function TicketAttachmentSection({
  workspaceSlug,
  ticketId,
  canEdit,
}: TicketAttachmentSectionProps) {
  const { attachments, pending, loading, error, busyId, upload, retry, dismiss, remove } = useTicketAttachments(
    workspaceSlug,
    ticketId,
  );
  const { showToast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach((file) => upload(file));
  };

  const handleRemove = async (attachmentId: string) => {
    try {
      await remove(attachmentId);
    } catch (cause) {
      showToast('error', getApiError(cause).status === 403 ? 'この操作を行う権限がありません。' : '添付を削除できませんでした。');
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragOver(false);
    if (!canEdit) return;
    handleFiles(e.dataTransfer.files);
  };

  if (loading) return <Loading size="small" />;

  return (
    <div
      onDragOver={(e) => {
        if (!canEdit) return;
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      role="group"
      aria-label="添付ファイル"
      className={`flex flex-col gap-1.5 rounded ${dragOver ? 'ring-2 ring-inset ring-brand-600' : ''}`}
    >
      {error && (
        <ErrorNotice variant="inline" message={error} />
      )}

      {!error && attachments.length === 0 && pending.length === 0 && (
        <EmptyNotice title="添付はありません" />
      )}

      {(attachments.length > 0 || pending.length > 0) && (
        <ul className="flex flex-col gap-1">
          {attachments.map((attachment) => (
            <TicketAttachmentRow
              key={attachment.id}
              workspaceSlug={workspaceSlug}
              ticketId={ticketId}
              attachment={attachment}
              canEdit={canEdit}
              busy={busyId === attachment.id}
              onRemove={() => void handleRemove(attachment.id)}
            />
          ))}
          {pending.map((p) => (
            <TicketPendingAttachmentRow
              key={p.clientId}
              pending={p}
              onRetry={() => retry(p.clientId)}
              onDismiss={() => dismiss(p.clientId)}
            />
          ))}
        </ul>
      )}

      {canEdit && (
        <>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={ACCEPTED_ATTACHMENT_ACCEPT_ATTR}
            className="sr-only"
            aria-label="添付ファイルを選ぶ"
            onChange={(e: ChangeEvent<HTMLInputElement>) => {
              handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center justify-center gap-1 rounded border border-dashed border-surface-3 px-2 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-surface-2"
          >
            <FsIcon name="paperclip" className="h-3.5 w-3.5" />
            ファイルを添付
          </button>
        </>
      )}
    </div>
  );
}
