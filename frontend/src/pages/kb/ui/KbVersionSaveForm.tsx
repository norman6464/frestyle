import { useState } from 'react';
import Button from '@/shared/ui/Button';

export interface KbVersionSaveFormProps {
  /** 送信。note は空でもよい。**失敗は投げてくる**前提（投げられたら入力を保つ）。 */
  onSubmit: (note: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * KbVersionSaveForm は「版を残す」の入力欄（任意のメモ + 送信/キャンセル）。
 *
 * KbCommentComposer と同じ骨組み — 本文（body）を持たない分だけ単純。
 * note は空でもよい（無記名の版も作れる）ので、KbCommentComposer と違い
 * 「空では送信不可」にはしない。
 *
 * **失敗しても入力は消さない。** 消すと書き直しになるうえ、何が悪かったのか分からない
 * （KbCommentComposer と同じ約束）。
 */
export default function KbVersionSaveForm({ onSubmit, onCancel }: KbVersionSaveFormProps) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(note.trim());
      setNote('');
    } catch {
      setError('版を残せませんでした。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        placeholder="メモ（任意）"
        aria-label="版のメモ"
        rows={2}
        disabled={submitting}
        className="w-full resize-none rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-60"
      />
      {error && (
        <p role="alert" className="text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" disabled={submitting} onClick={onCancel}>
          キャンセル
        </Button>
        <Button type="button" size="sm" loading={submitting} onClick={() => void handleSubmit()}>
          版を残す
        </Button>
      </div>
    </div>
  );
}
