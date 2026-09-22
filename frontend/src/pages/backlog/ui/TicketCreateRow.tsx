import { useState, type KeyboardEvent } from 'react';
import { Button } from '@/shared/ui';

export interface TicketCreateRowProps {
  onCreate: (title: string) => Promise<void>;
}

/** 一覧の末尾行。「題名を入力して Enter で作成」（見本どおり）。 */
export default function TicketCreateRow({ onCreate }: TicketCreateRowProps) {
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    <div className="flex flex-wrap items-center gap-2 border-b border-surface-3 px-3 py-3 text-sm">
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center text-[var(--color-text-faint)]" aria-hidden="true">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
          <path d="M5 12h14" />
          <path d="M12 5v14" />
        </svg>
      </span>
      <input
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="新しい作業の題名"
        aria-label="新しいチケットの題名"
        disabled={saving}
        className="min-h-11 min-w-0 flex-1 rounded-md border border-surface-3 bg-surface-1 px-3 text-base text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-brand-600 sm:text-sm"
      />
      <Button variant="secondary" className="min-h-11" disabled={!title.trim() || saving} loading={saving} onClick={() => void submit()}>追加</Button>
      {error && (
        <span role="alert" className="w-full text-sm text-red-700">
          {error}
        </span>
      )}
    </div>
  );
}
