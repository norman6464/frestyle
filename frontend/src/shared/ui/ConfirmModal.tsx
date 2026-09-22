import { useRef, type SyntheticEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import FsIcon from './icons/FsIcon';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}

/** 確認操作の共通部品。フォーカス・Escape・復帰先は Base UI に任せる。 */
export default function ConfirmModal({
  isOpen,
  title = '確認',
  message,
  confirmText = '削除',
  cancelText = 'キャンセル',
  onConfirm,
  onCancel,
  isDanger = true,
}: ConfirmModalProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 z-50 bg-black/50"
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
          onContextMenu={stopPropagation}
          onDragStart={stopPropagation}
        />
        <Dialog.Popup
          aria-modal="true"
          initialFocus={cancelRef}
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
          onContextMenu={stopPropagation}
          onDragStart={stopPropagation}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[var(--fs-dialog-border)] bg-[var(--fs-dialog-surface)] p-6 shadow-xl focus:outline-none"
        >
          <div className="mb-4 flex justify-center" aria-hidden="true">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${isDanger ? 'bg-danger-soft' : 'bg-brand-50'}`}>
              {isDanger ? <FsIcon name="trash" className="h-6 w-6 text-danger-ink" /> : <FsIcon name="help-circle" className="h-6 w-6 text-brand-700" />}
            </div>
          </div>
          <Dialog.Title className="mb-2 text-center text-xl font-semibold text-[var(--fs-text-strong)]">
            {title}
          </Dialog.Title>
          <Dialog.Description className="mb-6 text-center text-sm leading-relaxed text-[var(--fs-text-muted)]">
            {message}
          </Dialog.Description>
          <div className="flex gap-3">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              className="min-h-11 flex-1 rounded-lg border border-[var(--fs-control-border)] bg-[var(--fs-control-surface)] px-4 py-2.5 font-medium text-[var(--fs-text-strong)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`min-h-11 flex-1 rounded-lg px-4 py-2.5 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${isDanger ? 'bg-danger hover:bg-danger-hover' : 'bg-brand-600 hover:bg-brand-700'}`}
            >
              {confirmText}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
