import { useState } from 'react';
import type { KbIcon } from '@/entities/kb';
import { countGraphemes } from '@/shared/lib/graphemes';
import { KB_PAGE_ICON_EMOJIS } from '../config/pageIconEmojis';

export interface KbPageIconPickerProps {
  /** いま設定されているアイコン。null なら「外す」を出さない。 */
  current: KbIcon | null;
  /** 一覧・自由入力からの選択。**失敗は投げてくる**（開いたままにする。知らせは呼び出し側）。 */
  onSelect: (icon: KbIcon) => Promise<void>;
  /** 「外す」。**失敗は投げてくる**（onSelect と同じ理由）。 */
  onClear: () => Promise<void>;
  onClose: () => void;
}

/**
 * KbPageIconPicker はアイコンを選ぶ小さな格子 + 自由入力。
 *
 * 成功したら閉じる（onClose）。**失敗では開いたまま**にする — 閉じてしまうと、
 * 何が悪かったのか分からないまま設定前の状態に戻る（KbInlineRename と同じ約束）。
 * 知らせ（トースト）はここでは出さない。呼び出し側（KbPage）が出す。
 *
 * Escape はこのコンポーネント単体で閉じる。外側クリックで閉じる責務は
 * 開閉状態を持つ呼び出し側（KbPageIconButton）にある。
 */
export default function KbPageIconPicker({ current, onSelect, onClear, onClose }: KbPageIconPickerProps) {
  const [draft, setDraft] = useState('');
  // 自由入力の「1 文字だけ」検査に落ちたときの知らせ。API 失敗のトーストとは別物
  // （API を呼ぶ前に弾いているので、ここは呼び出し側に伝える必要が無い）。
  const [inputError, setInputError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const commitEmoji = async (value: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSelect({ type: 'emoji', value });
      onClose();
    } catch {
      // 開いたまま。知らせは呼び出し側が出す。
    } finally {
      setSaving(false);
    }
  };

  const submitDraft = async () => {
    const value = draft.trim();
    if (countGraphemes(value) !== 1) {
      setInputError('1 文字だけ入力してください');
      return;
    }
    setInputError(null);
    await commitEmoji(value);
  };

  const clear = async () => {
    if (saving) return;
    setSaving(true);
    try {
      await onClear();
      onClose();
    } catch {
      // 開いたまま。知らせは呼び出し側が出す。
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="ページのアイコンを選ぶ"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          onClose();
        }
      }}
      className="w-72 rounded-lg border border-surface-3 bg-surface-1 p-3 shadow-lg"
    >
      <div className="grid grid-cols-8 gap-1">
        {KB_PAGE_ICON_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            disabled={saving}
            aria-label={`アイコンを ${emoji} にする`}
            onClick={() => void commitEmoji(emoji)}
            className="flex h-8 w-8 items-center justify-center rounded text-lg hover:bg-surface-2 disabled:opacity-50"
          >
            {emoji}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-1.5">
        <input
          type="text"
          value={draft}
          disabled={saving}
          aria-label="絵文字を入力"
          placeholder="絵文字を入力"
          onChange={(event) => {
            setDraft(event.target.value);
            setInputError(null);
          }}
          onKeyDown={(event) => {
            // 日本語入力の変換確定 Enter は決定にしない（KbPageTitle と同じ理由）。
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              void submitDraft();
            }
          }}
          className="min-w-0 flex-1 rounded border border-surface-3 bg-transparent px-2 py-1 text-sm text-[var(--color-text-primary)] outline-none focus:border-brand-600"
        />
        <button
          type="button"
          disabled={saving}
          aria-label="入力した絵文字をアイコンに設定"
          onClick={() => void submitDraft()}
          className="shrink-0 rounded border border-surface-3 px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:opacity-50"
        >
          決定
        </button>
      </div>
      {inputError && (
        <p role="alert" className="mt-1 text-sm text-danger-ink">
          {inputError}
        </p>
      )}

      {current && (
        <button
          type="button"
          disabled={saving}
          aria-label="アイコンを外す"
          onClick={() => void clear()}
          className="mt-3 w-full rounded border border-surface-3 px-2 py-1 text-sm text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:opacity-50"
        >
          外す
        </button>
      )}
    </div>
  );
}
