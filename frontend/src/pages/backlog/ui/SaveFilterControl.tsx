import { useEffect, useRef, useState } from 'react';
import { FsIcon, NameCreateForm } from '@/shared/ui';
import { savedFilterErrorMessage } from '../lib/savedFilterError';

export interface SaveFilterControlProps {
  /** 名前を受け取って保存する。失敗は投げてくる（理由は文言にして欄の下に出す）。 */
  onSave: (name: string) => Promise<void>;
}

/**
 * 一覧の下の右端に置く「この絞り込みを保存 ＋」（設計ボード ST09）。押すとその場で名前の欄が
 * 開き、確定するといまの条件に名前が付く。
 *
 * 別の窓にしないのは、保存するのは「いま見えている一覧の条件」で、その一覧のすぐ下で
 * 名前を付ける方が何を保存するのかが分かるため。失敗は欄の下に理由を出し、入力は消さない。
 * 閉じたら（確定でも取り消しでも）元のボタンへフォーカスを戻す。
 */
export default function SaveFilterControl({ onSave }: SaveFilterControlProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  useEffect(() => {
    if (open || !returnFocus.current) return;
    returnFocus.current = false;
    triggerRef.current?.focus();
  }, [open]);

  const close = () => {
    returnFocus.current = true;
    setOpen(false);
    setError(null);
  };

  if (!open) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-brand-700 transition-colors duration-fast hover:bg-action-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
      >
        この絞り込みを保存
        <FsIcon name="plus" className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className="flex min-w-0 flex-col items-end gap-1">
      <NameCreateForm
        what="絞り込み"
        layout="inline"
        autoFocus
        submitLabel="保存する"
        onCancel={close}
        onCreate={async ({ name }) => {
          try {
            await onSave(name);
          } catch (cause) {
            setError(savedFilterErrorMessage(cause, '保存できませんでした。時間をおいてもう一度お試しください。'));
            throw cause;
          }
          close();
        }}
      />
      {error && (
        <p role="alert" className="text-xs text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
