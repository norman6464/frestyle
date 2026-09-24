import { useRef, type ReactNode, type SyntheticEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import FsIcon from './icons/FsIcon';
import type { FsIconName } from './icons/fsIconParts';

interface ConfirmModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** 取り消せない・失うものがある操作のとき true。確定ボタンが赤になる。既定は false。 */
  isDanger?: boolean;
  /**
   * 見出しの上の印。既定は危険なら注意の三角、そうでなければ問いの印。ごみ箱は「消す」ときだけ
   * 明示して使う（取り消し・外す・停止にごみ箱を出すと、消えるものを取り違える）。
   */
  icon?: FsIconName;
  /** 確定の処理中。ボタンを押せなくし、確定ボタンに「処理中」を出す（二重に送らない）。 */
  pending?: boolean;
  /**
   * 何に対する操作かを見せる小さな枠（例: 辞退する招待のワークスペース名）。説明文の上に置く。
   * 文言だけだと、同じ見た目の確認が続いたときにどれへの操作か取り違える。
   */
  children?: ReactNode;
}

/**
 * 確認操作の共通部品。フォーカス・Escape・復帰先は Base UI に任せる。
 *
 * 既定は中立（確定ボタンは青、文言は「確定する」）。危険な操作は isDanger を明示する
 * （既定を危険側にすると、文言を渡し忘れた普通の確認が赤い「削除」になる）。
 */
export default function ConfirmModal({
  isOpen,
  title = '確認',
  message,
  confirmText = '確定する',
  cancelText = 'キャンセル',
  onConfirm,
  onCancel,
  isDanger = false,
  icon,
  pending = false,
  children,
}: ConfirmModalProps) {
  const iconName: FsIconName = icon ?? (isDanger ? 'alert-triangle' : 'help-circle');
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
              <FsIcon name={iconName} className={`h-6 w-6 ${isDanger ? 'text-danger-ink' : 'text-brand-700'}`} />
            </div>
          </div>
          <Dialog.Title className="mb-2 text-center text-xl font-semibold text-[var(--fs-text-strong)]">
            {title}
          </Dialog.Title>
          {children && <div className="mb-4">{children}</div>}
          <Dialog.Description className="mb-6 text-center text-sm leading-relaxed text-[var(--fs-text-muted)]">
            {message}
          </Dialog.Description>
          <div className="flex gap-3">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              disabled={pending}
              className="min-h-11 flex-1 rounded-lg border border-[var(--fs-control-border)] bg-[var(--fs-control-surface)] px-4 py-2.5 font-medium text-[var(--fs-text-strong)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {cancelText}
            </button>
            <button
              type="button"
              onClick={() => {
                if (!pending) onConfirm();
              }}
              disabled={pending}
              aria-busy={pending || undefined}
              className={`min-h-11 flex-1 rounded-lg px-4 py-2.5 font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-60 ${isDanger ? 'bg-danger hover:bg-danger-hover' : 'bg-brand-600 hover:bg-brand-700'}`}
            >
              {pending ? '処理中…' : confirmText}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
