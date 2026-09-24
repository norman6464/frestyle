import { useState } from 'react';
import type { Label } from '@/entities/ticket';
import { validateLabel, normalizeLabelColor } from '../lib/validateLabel';

export interface TicketLabelPickerProps {
  /** ワークスペースに定義されている全ラベル。 */
  labels: Label[];
  /** このチケットに付いているラベルの ID。 */
  attachedIds: string[];
  onToggle: (label: Label) => void;
  onCreate: (name: string, color: string) => Promise<Label>;
}

const DEFAULT_COLOR = '#2563eb';

/**
 * ラベルの選択。浮かせずその場に展開し、絞り込み・付け外し・新規作成までをここで完結させる
 * （バックログ画面に管理用の 4 つ目のタブを足さない判断。付けるついでに作るのが自然なため）。
 */
export default function TicketLabelPicker({ labels, attachedIds, onToggle, onCreate }: TicketLabelPickerProps) {
  const [filter, setFilter] = useState('');
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attached = new Set(attachedIds);
  const visible = labels.filter((l) => l.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const handleCreate = async () => {
    const validation = validateLabel(newName, newColor);
    if (validation) {
      setError(validation.name ?? validation.color ?? null);
      return;
    }
    // 前後の空白違いは backend 側で重複扱いになるので、ここでも trim して送る。
    const trimmed = newName.trim();
    setCreating(true);
    setError(null);
    try {
      await onCreate(trimmed, normalizeLabelColor(newColor));
      setNewName('');
    } catch (cause) {
      const status = (cause as { response?: { status?: number } })?.response?.status;
      setError(status === 409 ? 'その名前のラベルは既にあります。' : 'ラベルを作れませんでした。');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-1 rounded-lg border border-surface-3 bg-surface-1 p-2">
      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="ラベルを絞り込む"
        aria-label="ラベルを絞り込む"
        className="mb-1 w-full rounded border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
      />

      <ul className="max-h-48 overflow-y-auto">
        {visible.length === 0 && <li className="px-1 py-1.5 text-xs text-[var(--color-text-muted)]">見つかりません</li>}
        {visible.map((label) => {
          const isOn = attached.has(label.id);
          return (
            <li key={label.id}>
              <button
                type="button"
                onClick={() => onToggle(label)}
                aria-pressed={isOn}
                aria-label={isOn ? `ラベル ${label.name} を外す` : `ラベル ${label.name} を付ける`}
                className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs ${
                  isOn ? 'bg-brand-50' : 'hover:bg-surface-2'
                }`}
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 flex-none rounded-full" style={{ backgroundColor: label.color }} />
                <span className="min-w-0 flex-1 truncate text-[var(--color-text-primary)]">{label.name}</span>
                {isOn && (
                  <span aria-hidden="true" className="text-brand-700">
                    ✓
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ul>

      <hr className="my-1.5 border-surface-3" />

      <div className="flex items-center gap-1.5">
        <input
          type="color"
          value={newColor}
          onChange={(e) => setNewColor(e.target.value)}
          aria-label="新しいラベルの色"
          className="h-6 w-6 flex-none cursor-pointer rounded border border-surface-3 bg-transparent p-0"
        />
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            // 日本語入力の変換確定 Enter は入力欄の確定ではない。isComposing を見ないと、
            // 変換のたびに打ちかけの名前でラベル作成が飛ぶ（keyCode 229 は Safari の変換中の値）。
            if (e.nativeEvent.isComposing || e.keyCode === 229) return;
            if (e.key === 'Enter') void handleCreate();
          }}
          placeholder="新しいラベルの名前"
          aria-label="新しいラベルの名前"
          className="min-w-0 flex-1 rounded border border-surface-3 bg-surface-1 px-2 py-1 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
        />
        <button
          type="button"
          onClick={() => void handleCreate()}
          disabled={creating || newName.trim() === ''}
          className="flex-none rounded bg-brand-600 px-2 py-1 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
        >
          作る
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger-ink">
          {error}
        </p>
      )}
    </div>
  );
}
