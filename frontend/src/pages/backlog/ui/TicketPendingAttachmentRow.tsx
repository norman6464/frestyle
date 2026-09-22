import { ArrowPathIcon, DocumentIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { PendingAttachment } from '../model/useTicketAttachments';
import { formatFileSize } from '../lib/formatFileSize';

export interface TicketPendingAttachmentRowProps {
  pending: PendingAttachment;
  onRetry: () => void;
  onDismiss: () => void;
}

/**
 * アップロード中・失敗の 1 行。成功すると消え、TicketAttachmentRow 側へ移る。
 *
 * 失敗の理由と操作は 2 行目に分ける（副列の幅は 20rem 未満のことがあり、ファイル名・
 * サイズ・理由・やり直す・取り消すを 1 行に収めると、いちばん読みたいファイル名が
 * 真っ先に削れる）。
 */
export default function TicketPendingAttachmentRow({ pending, onRetry, onDismiss }: TicketPendingAttachmentRowProps) {
  return (
    <li className="rounded border border-surface-3 px-2 py-1.5 text-xs">
      <div className="flex items-center gap-2">
        <DocumentIcon className="h-4 w-4 flex-none text-[var(--color-text-muted)]" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]" title={pending.file.name}>
          {pending.file.name}
        </span>
        <span className="flex-none text-[11px] text-[var(--color-text-muted)]">
          {formatFileSize(pending.file.size)}
        </span>
        {pending.status === 'uploading' && (
          <span role="status" className="flex-none text-sm text-[var(--color-text-muted)]">
            アップロード中…
          </span>
        )}
      </div>
      {pending.status === 'failed' && (
        <div className="mt-1 flex items-center gap-2 pl-6">
          <span role="alert" className="min-w-0 flex-1 truncate text-sm text-danger-ink" title={pending.error ?? ''}>
            {pending.error}
          </span>
          <button
            type="button"
            onClick={onRetry}
            aria-label={`${pending.file.name} のアップロードをやり直す`}
            className="flex-none rounded p-1 text-[var(--color-text-muted)] hover:bg-surface-2"
          >
            <ArrowPathIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={onDismiss}
            aria-label={`${pending.file.name} を取り消す`}
            className="flex-none rounded p-1 text-[var(--color-text-muted)] hover:bg-surface-2"
          >
            <XMarkIcon className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
    </li>
  );
}
