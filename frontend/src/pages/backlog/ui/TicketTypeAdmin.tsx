import { useId, useState, type FormEvent } from 'react';
import type { TicketHierarchyLevel, TicketType, TicketTypeInput } from '@/entities/ticket';
import { getApiError } from '@/shared/lib/classifyApiError';

export interface TicketTypeAdminProps {
  types: TicketType[];
  onCreate: (input: TicketTypeInput) => Promise<TicketType>;
  onSetDefault: (typeId: string) => Promise<void>;
  onArchive: (typeId: string) => Promise<void>;
}

const HIERARCHY_LABEL: Record<number, string> = { 1: '束ね（1）', 0: '標準（0）', [-1]: '小作業（-1）' };
const DEFAULT_COLOR = '#2563eb';

/** 種別の管理表（TicketStatusAdmin と同じ形）。 */
export default function TicketTypeAdmin({ types, onCreate, onSetDefault, onArchive }: TicketTypeAdminProps) {
  const [rowMessage, setRowMessage] = useState<Record<string, string>>({});
  const [name, setName] = useState('');
  const [hierarchyLevel, setHierarchyLevel] = useState<TicketHierarchyLevel>(0);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameId = useId();
  const levelId = useId();

  const handleArchive = async (type: TicketType) => {
    setRowMessage((prev) => ({ ...prev, [type.id]: '' }));
    try {
      await onArchive(type.id);
    } catch (cause) {
      const code = getApiError(cause).serverCode;
      setRowMessage((prev) => ({
        ...prev,
        [type.id]:
          code === 'type_in_use'
            ? `この種別は ${type.activeTicketCount} 件のチケットで使われています。`
            : '種別をアーカイブできませんでした。',
      }));
    }
  };

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    setFormError(null);
    try {
      await onCreate({ name: trimmed, hierarchyLevel, color });
      setName('');
      setHierarchyLevel(0);
      setColor(DEFAULT_COLOR);
    } catch (cause) {
      const code = getApiError(cause).serverCode;
      setFormError(code === 'type_name_taken' ? '同じ名前の種別が既にあります。' : '種別を追加できませんでした。');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <div role="region" aria-label="種別の一覧（横にスクロールできます）" tabIndex={0} className="overflow-x-auto rounded-lg border border-surface-3 p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
      <table className="w-full min-w-[32rem] text-left text-sm">
        <thead>
          <tr className="border-b border-surface-3 text-[10.5px] font-semibold uppercase tracking-wide text-[var(--color-text-muted)]">
            <th className="py-1.5 font-semibold">名前</th>
            <th className="w-28 py-1.5 font-semibold">階層</th>
            <th className="w-24 py-1.5 font-semibold">既定</th>
            <th className="w-20 py-1.5 text-right font-semibold">使用中</th>
            <th className="w-20 py-1.5 text-right font-semibold">操作</th>
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type.id} className="border-b border-surface-3">
              <td className="py-1.5 font-semibold">
                <span
                  className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle"
                  style={{ backgroundColor: type.color }}
                  aria-hidden="true"
                />
                {type.name}
              </td>
              <td className="py-1.5 text-[var(--color-text-muted)]">{HIERARCHY_LABEL[type.hierarchyLevel]}</td>
              <td className="py-1.5">
                {type.isDefault ? (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-xs font-medium text-[var(--color-text-secondary)]">
                    既定
                  </span>
                ) : (
                  <button
                    type="button"
                    onClick={() => void onSetDefault(type.id)}
                    className="text-xs font-medium text-brand-700 hover:underline"
                  >
                    これにする
                  </button>
                )}
              </td>
              <td className="py-1.5 text-right text-[var(--color-text-muted)]">{type.activeTicketCount} 件</td>
              <td className="py-1.5 text-right">
                <button
                  type="button"
                  onClick={() => void handleArchive(type)}
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

      {Object.values(rowMessage).find((m) => m) && (
        <div role="alert" className="mt-2 rounded border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {Object.values(rowMessage).find((m) => m)}
        </div>
      )}

      <form onSubmit={handleCreate} className="mt-5 flex flex-wrap items-end gap-3 [&_input]:min-h-11 [&_select]:min-h-11 [&_button]:min-h-11">
        <div className="min-w-0 basis-full sm:flex-1 sm:basis-48">
          <label htmlFor={nameId} className="mb-0.5 block text-xs text-[var(--color-text-muted)]">
            種別の名前
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
          <label htmlFor={levelId} className="mb-0.5 block text-xs text-[var(--color-text-muted)]">
            階層
          </label>
          <select
            id={levelId}
            value={hierarchyLevel}
            onChange={(e) => setHierarchyLevel(Number(e.target.value) as TicketHierarchyLevel)}
            className="rounded border border-surface-3 bg-surface-1 px-2 py-1 text-sm"
          >
            <option value={1}>束ね（1）</option>
            <option value={0}>標準（0）</option>
            <option value={-1}>小作業（-1）</option>
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
    </div>
  );
}
