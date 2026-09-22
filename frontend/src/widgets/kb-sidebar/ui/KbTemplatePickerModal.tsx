import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import type { KbPageTemplate } from '@/entities/kb';
import Button from '@/shared/ui/Button';
import ConfirmModal from '@/shared/ui/ConfirmModal';

export interface KbTemplatePickerModalProps {
  isOpen: boolean;
  templates: KbPageTemplate[];
  loading: boolean;
  error: string | null;
  /**
   * テンプレートの削除ボタンを出すか（ワークスペースの編集者 editor 以上）。
   * 一覧を見る・テンプレートから作ることは所属者なら誰でもできるので、この旗は
   * 削除ボタンの表示だけに使う。
   */
  canManageTemplates: boolean;
  /** テンプレートを選んで題名を確定する。**失敗は投げてくる**（フォーム内にエラーを出す）。 */
  onConfirm: (templateId: string, title: string) => Promise<void>;
  /** テンプレートを削除する。**失敗は投げてくる**（一覧内にエラーを出す）。 */
  onDelete: (templateId: string) => Promise<void>;
  onClose: () => void;
}

/**
 * KbTemplatePickerModal は「雛形からページを作る」の共通ピッカー。
 *
 * サイドバーの「雛形から作る」と、本文の /template コマンドの両方から開かれる想定
 * （widgets/kb-sidebar 側に置くのは useKbPageTemplates と同じ理由 — pages/kb からは
 * import できても widgets からは pages を import できない）。
 *
 * 2 段階: テンプレートを選ぶ一覧 → 題名を決める入力欄（初期値はテンプレート名、変更可）。
 * KbSearchDialog と同じ流儀（portal・Escape・オーバーレイクリックで閉じる）で、
 * ConfirmModal のような厳密なフォーカストラップは持たない。
 *
 * 削除は KbRowActions と同じ流儀で ConfirmModal による確認を経る。
 */
export default function KbTemplatePickerModal({
  isOpen,
  templates,
  loading,
  error,
  canManageTemplates,
  onConfirm,
  onDelete,
  onClose,
}: KbTemplatePickerModalProps) {
  const titleId = useId();
  const [selected, setSelected] = useState<KbPageTemplate | null>(null);
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // 閉じたら打ちかけの状態を持ち越さない（次に開いたとき常に一覧の頭から）。
  useEffect(() => {
    if (isOpen) return;
    setSelected(null);
    setTitle('');
    setSubmitting(false);
    setSubmitError(null);
    setConfirmingDeleteId(null);
    setDeleteError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      // 削除の確認モーダルが出ている間は、Escape は ConfirmModal 側の onCancel だけが処理する
      // （ここで onClose すると、確認モーダルごとピッカー全体が閉じてしまう）。
      if (event.key === 'Escape' && confirmingDeleteId === null) onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose, confirmingDeleteId]);

  if (!isOpen) return null;

  const selectTemplate = (template: KbPageTemplate) => {
    setSelected(template);
    setTitle(template.name);
    setSubmitError(null);
  };

  const back = () => {
    setSelected(null);
    setSubmitError(null);
  };

  const handleConfirm = async () => {
    const trimmed = title.trim();
    if (!selected || !trimmed || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await onConfirm(selected.id, trimmed);
    } catch {
      setSubmitError('ページを作成できませんでした。');
      setSubmitting(false);
      return;
    }
    setSubmitting(false);
  };

  const handleDelete = async (templateId: string) => {
    setConfirmingDeleteId(null);
    setDeleteError(null);
    try {
      await onDelete(templateId);
    } catch {
      setDeleteError('削除できませんでした。');
    }
  };

  const deletingTemplateName = templates.find((template) => template.id === confirmingDeleteId)?.name ?? '';

  return createPortal(
    <div
      className="fixed inset-0 z-40 flex items-start justify-center pt-[18vh]"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        data-testid="kb-template-picker-overlay"
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative flex max-h-[60vh] w-full max-w-md flex-col overflow-hidden rounded-xl border border-surface-3 bg-surface-1 shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-surface-3 px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-[var(--color-text-primary)]">
            {selected ? '題名を決める' : '雛形を選ぶ'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="閉じる"
            className="rounded p-1 text-[var(--color-text-muted)] hover:bg-surface-2"
          >
            <XMarkIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {!selected && (
            <>
              {loading && (
                <div className="flex flex-col gap-1.5" role="status" aria-label="テンプレートを読み込み中">
                  <div className="h-9 animate-skeleton rounded bg-surface-2" />
                  <div className="h-9 animate-skeleton rounded bg-surface-2" />
                </div>
              )}
              {!loading && error && (
                <p role="alert" className="text-sm leading-relaxed text-danger-ink">
                  {error}
                </p>
              )}
              {!loading && !error && templates.length === 0 && (
                <p className="px-1 py-2 text-xs leading-relaxed text-[var(--color-text-muted)]">
                  まだテンプレートがありません。
                </p>
              )}
              {!loading && !error && templates.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {templates.map((template) => (
                    <li key={template.id} className="group flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => selectTemplate(template)}
                        className="min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
                      >
                        {template.icon?.value ? `${template.icon.value} ` : ''}
                        {template.name}
                      </button>
                      {canManageTemplates && (
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(template.id)}
                          aria-label={`${template.name} を削除`}
                          className="shrink-0 rounded p-1 text-[var(--color-text-muted)] opacity-0 transition-opacity hover:bg-surface-3 focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <TrashIcon className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {deleteError && (
                <p role="alert" className="mt-2 text-sm leading-relaxed text-danger-ink">
                  {deleteError}
                </p>
              )}
            </>
          )}

          {selected && (
            <div className="flex flex-col gap-2">
              <div>
                <label
                  htmlFor={`${titleId}-input`}
                  className="mb-1 block text-xs text-[var(--color-text-muted)]"
                >
                  新しいページの題名
                </label>
                <input
                  id={`${titleId}-input`}
                  type="text"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  disabled={submitting}
                  className="w-full rounded border border-surface-3 bg-surface-1 px-2 py-1.5 text-sm text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none disabled:opacity-60"
                />
              </div>
              {submitError && (
                <p role="alert" className="text-sm leading-relaxed text-danger-ink">
                  {submitError}
                </p>
              )}
              <div className="flex justify-end gap-2">
                <Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={back}>
                  戻る
                </Button>
                <Button
                  type="button"
                  size="sm"
                  loading={submitting}
                  disabled={!title.trim()}
                  onClick={() => void handleConfirm()}
                >
                  作成
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmingDeleteId !== null}
        title="テンプレートを削除"
        message={`「${deletingTemplateName}」を削除します。元に戻せません。`}
        confirmText="削除"
        onConfirm={() => void handleDelete(confirmingDeleteId as string)}
        onCancel={() => setConfirmingDeleteId(null)}
      />
    </div>,
    document.body,
  );
}
