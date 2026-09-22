import { useId, useState, type FormEvent } from 'react';
import { TicketStatusPill, type TicketStatus, type TicketStatusCategory, type TicketStatusInput } from '@/entities/ticket';
import { getApiError } from '@/shared/lib/classifyApiError';

export interface TicketStatusAdminProps {
  statuses: TicketStatus[];
  onCreate: (input: TicketStatusInput) => Promise<TicketStatus>;
  onSetInitial: (statusId: string) => Promise<void>;
  onArchive: (statusId: string) => Promise<void>;
}

const CATEGORY_LABEL: Record<TicketStatusCategory, string> = {
  todo: '未着手',
  in_progress: '進行中',
  done: '完了',
};

const DEFAULT_COLOR = '#5b6b7a';

/**
 * 状態の管理表（設計 Ⅲ・Ⅷ）。使用中のアーカイブ・名前の重複・初期状態のアーカイブは
 * すべて 409/400 として backend から返る — ここでは個別の文言に変換するだけで、
 * 遷移規則そのものはこの画面では編集させない（設計上どの状態へも動ける）。
 */
export default function TicketStatusAdmin({ statuses, onCreate, onSetInitial, onArchive }: TicketStatusAdminProps) {
  const [rowError, setRowError] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TicketStatusCategory>('todo');
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const catId = useId();

  const handleArchive = async (status: TicketStatus) => {
    setRowError((prev) => ({ ...prev, [status.id]: '' }));
    try {
      await onArchive(status.id);
    } catch (cause) {
      const code = getApiError(cause).serverCode;
      const message =
        code === 'status_in_use'
          ? `「${status.name}」は ${status.activeTicketCount} 件のチケットで使われているため、アーカイブできません。`
          : code === 'invalid_request'
            ? '初期状態はアーカイブできません。先に別の状態を初期にしてください。'
            : '状態をアーカイブできませんでした。';
      setRowError((prev) => ({ ...prev, [status.id]: message }));
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await onCreate({ name: trimmed, category, color });
      setName('');
      setCategory('todo');
      setColor(DEFAULT_COLOR);
    } catch (cause) {
      const code = getApiError(cause).serverCode;
      setFormError(code === 'status_name_taken' ? '同じ名前の状態が既にあります。' : '状態を追加できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div role="region" aria-label="状態の一覧（横にスクロールできます）" tabIndex={0} className="overflow-x-auto rounded-lg border border-surface-3 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead>
          <tr className="border-b border-surface-3 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="py-1.5 font-semibold">名前</th>
            <th className="w-24 py-1.5 font-semibold">枠</th>
            <th className="w-20 py-1.5 font-semibold">色</th>
            <th className="w-24 py-1.5 font-semibold">初期</th>
            <th className="w-20 py-1.5 text-right font-semibold">使用中</th>
            <th className="w-20 py-1.5 text-right font-semibold">操作</th>
          </tr>
        </thead>
        <tbody>
          {statuses.map((status) => (
            <tr key={status.id} className="border-b border-surface-3">
              <td className="py-1.5">
                <TicketStatusPill name={status.name} color={status.color} category={status.category} />
              </td>
              <td className="py-1.5 text-[var(--color-text-muted)]">{CATEGORY_LABEL[status.category]}</td>
              <td className="py-1.5">
                <span
                  className="inline-block h-3.5 w-3.5 rounded-full border border-surface-3"
                  style={{ backgroundColor: status.color }}
                  aria-hidden="true"
                />
              </td>
              <td className="py-1.5">
                {status.isInitial ? (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
                    初期
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSetInitial(status.id)}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    これにする
                  </button>
                )}
              </td>
              <td className="py-1.5 text-right text-[var(--color-text-muted)]">{status.activeTicketCount} 件</td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => void handleArchive(status)}
                  className="text-xs font-medium text-[var(--color-text-muted)] hover:text-red-600 hover:underline"
                >
                  アーカイブ
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="mt-2 text-xs text-[var(--color-text-muted)] sm:hidden">一覧は横にスクロールして確認できます。</p>

      {Object.values(rowError).find((m) => m) && (
        <div role="alert" className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {Object.values(rowError).find((m) => m)}
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-5 flex flex-wrap items-end gap-3 [&_input]:min-h-11 [&_select]:min-h-11 [&_button]:min-h-11">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-48">
          <label htmlFor={nameId} className="mb-0.5 block text-xs text-[var(--color-text-muted)]">
            状態の名前
          </label>
          <input
            id={nameId}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-md border border-surface-3 bg-surface-1 px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-brand-600 sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor={catId} className="mb-0.5 block text-xs text-[var(--color-text-muted)]">
            枠
          </label>
          <select
            id={catId}
            value={category}
            onChange={(e) => setCategory(e.target.value as TicketStatusCategory)}
            className="rounded border border-surface-3 bg-surface-1 px-2 py-1 text-sm"
          >
            <option value="todo">未着手</option>
            <option value="in_progress">進行中</option>
            <option value="done">完了</option>
          </select>
        </div>
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          aria-label="色"
          className="h-11 w-11 rounded-md border border-surface-3 bg-surface-1"
        />
        <button
          type="submit"
          disabled={saving || !name.trim()}
          className="rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-40"
        >
          追加
        </button>
      </form>
      {formError && (
        <p role="status" className="mt-1 text-xs text-red-600">
          {formError}
        </p>
      )}

      <p className="mt-4 text-xs leading-relaxed text-[var(--color-text-muted)]">
        状態は順序に関係なく変更できます。使用中の状態や初期状態は、そのままではアーカイブできません。
      </p>
    </div>
  );
}
