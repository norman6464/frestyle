import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { PaperClipIcon } from '@heroicons/react/24/outline';
import Loading from '@/shared/ui/Loading';
import { useToast } from '@/shared/lib/hooks/useToast';
import { getApiError } from '@/shared/lib/classifyApiError';
import { useTicketAttachments } from '../model/useTicketAttachments';
import { ACCEPTED_ATTACHMENT_ACCEPT_ATTR } from '../config/attachmentUpload';
import TicketAttachmentRow from './TicketAttachmentRow';
import TicketPendingAttachmentRow from './TicketPendingAttachmentRow';

export interface TicketAttachmentSectionProps {
  workspaceSlug: string;
  ticketId: string;
  canEdit: boolean;
  /** 取得できた件数を親へ知らせる（見出しに出すため）。 */
  onCountChange?: (count: number) => void;
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
  onCountChange,
}: TicketAttachmentSectionProps) {
  const { attachments, pending, loading, error, busyId, upload, retry, dismiss, remove } = useTicketAttachments(
    workspaceSlug,
    ticketId,
  );
  const { showToast } = useToast();
  // 件数は見出し（TicketSection の count）が持つ。ここは数えて渡すだけで、表示には使わない。
  useEffect(() => {
    onCountChange?.(attachments.length);
  }, [attachments.length, onCountChange]);
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
      className={`flex flex-col gap-1.5 rounded ${dragOver ? 'ring-2 ring-inset ring-brand-400' : ''}`}
    >
      {error && (
        <p role="alert" className="text-xs text-red-700">
          {error}
        </p>
      )}

      {!error && attachments.length === 0 && pending.length === 0 && (
        <p className="text-xs text-[var(--color-text-muted)]">添付はありません</p>
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
            <PaperClipIcon className="h-3.5 w-3.5" aria-hidden="true" />
            ファイルを添付
          </button>
        </>
      )}
    </div>
  );
}
