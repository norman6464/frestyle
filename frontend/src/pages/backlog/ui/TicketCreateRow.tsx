import { useState, type KeyboardEvent } from 'react';
import { PlusIcon } from '@heroicons/react/20/solid';
import { Button } from '@/shared/ui';

export interface TicketCreateRowProps {
  onCreate: (title: string) => Promise<void>;
}

/**
 * 一覧の末尾行。「題名を入力して Enter で作成」（設計ボード ST08）。
 *
 * 枠のある入力欄を常に置くと、一覧の最後に空のフォームが 1 行居座る。文字を打つまでは
 * 「＋ 題名を入力して Enter で作成」という 1 行の誘い文句に見え、打ち始めると「追加」が現れる。
 */
export default function TicketCreateRow({ onCreate }: TicketCreateRowProps) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canSubmit = title.trim() !== '' && !saving;

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onCreate(trimmed);
      setTitle('');
    } catch {
      setError('チケットを作成できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // IME 変換確定の Enter で誤送信しない。
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div role="row" className="border-b border-surface-3">
      <div role="cell" aria-colspan={6} className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm sm:px-4">
        <PlusIcon className="h-4 w-4 shrink-0 text-brand-600" aria-hidden="true" />
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="題名を入力して Enter で作成"
          aria-label="新しいチケットの題名"
          disabled={saving}
          className="min-h-11 min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 text-base text-[var(--color-text-primary)] transition-colors duration-fast placeholder:text-[var(--color-text-muted)] hover:border-surface-3 focus:border-brand-600 focus:outline-none focus:ring-2 focus:ring-brand-600 sm:text-sm"
        />
        {title.trim() !== '' && (
          <Button variant="secondary" size="sm" disabled={!canSubmit} loading={saving} onClick={() => void submit()}>
            追加
          </Button>
        )}
        {error && (
          <span role="alert" className="w-full text-sm text-danger-ink">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
