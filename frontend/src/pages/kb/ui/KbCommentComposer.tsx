import { useState } from 'react';
import Button from '@/shared/ui/Button';

export interface KbCommentComposerProps {
  /** 送信。**失敗は投げてくる**前提（投げられたら入力を保つ。書き直させないため）。 */
  onSubmit: (body: unknown[]) => Promise<void>;
  placeholder?: string;
}

/** プレーンテキストを、本文が持つのと同じ形（ProseMirror インラインノードの配列）に変換する。 */
function bodyFromText(text: string): unknown[] {
  return [{ type: 'text', text }];
}

/**
 * KbCommentComposer は 1 コメントぶんの入力欄（複数行 + 送信ボタン）。
 *
 * 本文はリッチな装飾を持たない「1 段落ぶんのプレーンテキスト」として送る
 * （RichTextEditor ほどの入力は今回のスコープ外）。空文字・空白のみは送信できない。
 *
 * **失敗しても入力は消さない。** 消すと書き直しになるうえ、何が悪かったのか分からない
 * （KbPageTitle・KbPageIconPicker と同じ約束）。ここでは知らせを自分でも出す
 * （呼び出し側のトーストとは別に、この場で次にどうすればよいかを示す）。
 */
export default function KbCommentComposer({ onSubmit, placeholder }: KbCommentComposerProps) {
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const canSubmit = trimmed !== '' && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(bodyFromText(value));
      setValue('');
    } catch {
      setError('送信できませんでした。もう一度お試しください。');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder ?? 'コメント'}
        rows={2}
        disabled={submitting}
        className="w-full resize-none rounded-md border border-surface-3 bg-surface-1 px-2.5 py-1.5 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-faint)] focus:outline-none focus:ring-1 focus:ring-brand-600 disabled:opacity-60"
      />
      {error && (
        <p role="alert" className="text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="button" size="sm" loading={submitting} disabled={!canSubmit} onClick={() => void handleSubmit()}>
          送信
        </Button>
      </div>
    </div>
  );
}
