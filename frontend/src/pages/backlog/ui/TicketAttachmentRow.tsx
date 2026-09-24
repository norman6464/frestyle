import { useState } from 'react';
import { TicketRepository, type TicketAttachment } from '@/entities/ticket';
import { formatFileSize } from '../lib/formatFileSize';
import { FsIcon } from '@/shared/ui';

export interface TicketAttachmentRowProps {
  workspaceSlug: string;
  ticketId: string;
  attachment: TicketAttachment;
  canEdit: boolean;
  /** 削除が飛んでいる間 true。 */
  busy: boolean;
  onRemove: () => void;
}

/**
 * 確定済みの添付 1 件。ダウンロードは都度 presigned URL を発行してから開く
 * （key を保存しない・期限切れの心配をしない設計。entities/ticket/model/types.ts 参照）。
 */
export default function TicketAttachmentRow({
  workspaceSlug,
  ticketId,
  attachment,
  canEdit,
  busy,
  onRemove,
}: TicketAttachmentRowProps) {
  const [downloading, setDownloading] = useState(false);
  const [downloadFailed, setDownloadFailed] = useState(false);

  const handleDownload = async () => {
    setDownloading(true);
    setDownloadFailed(false);
    try {
      const { url } = await TicketRepository.issueTicketAttachmentDownloadUrl(workspaceSlug, ticketId, attachment.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      setDownloadFailed(true);
    } finally {
      setDownloading(false);
    }
  };


  return (
    <li className="flex items-center gap-2 rounded border border-surface-3 px-2 py-1.5 text-xs">
      <FsIcon
        name={attachment.contentType.startsWith('image/') ? 'image' : 'document'}
        className="h-4 w-4 flex-none text-[var(--color-text-muted)]"
      />
      <button
        type="button"
        onClick={() => void handleDownload()}
        disabled={downloading}
        className="min-w-0 flex-1 truncate text-left text-[var(--color-text-primary)] hover:underline disabled:opacity-50"
        title={attachment.filename}
      >
        {attachment.filename}
      </button>
      <span className="flex-none text-xs text-[var(--color-text-muted)]">
        {formatFileSize(attachment.sizeBytes)}
      </span>
      {downloadFailed && (
        <span role="alert" className="flex-none text-sm text-danger-ink">
          取得できませんでした
        </span>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={onRemove}
          disabled={busy}
          aria-label={`${attachment.filename} を削除`}
          className="flex-none rounded p-1 text-[var(--color-text-muted)] hover:bg-surface-2 hover:text-danger-ink disabled:opacity-50"
        >
          {busy ? (
            <FsIcon name="refresh" className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <FsIcon name="trash" className="h-3.5 w-3.5" />
          )}
        </button>
      )}
    </li>
  );
}
