import { useState } from 'react';
import type { ReactionSummary } from '../lib/summarizeReactions';
import TicketReactionPicker from './TicketReactionPicker';

export interface TicketReactionBarProps {
  reactions: ReactionSummary[];
  /** 自分の userId が引けていないと押す側の判定ができないので、＋ を出さない。 */
  canReact: boolean;
  onToggle: (emoji: string) => void;
}

/**
 * 発言 1 件の反応の列。押すと外れる/付く（付け外しは呼び出し側が 204 応答を待ってから
 * 手元を更新する。ここでは楽観更新をしない）。
 *
 * ＋ を押すと、浮かせずその場に絵文字の格子を展開する（TicketReactionPicker）。
 * 1 本スクロールの中で絶対配置を出した前例が無く、枠で切れる懸念を消すため。
 */
export default function TicketReactionBar({ reactions, canReact, onToggle }: TicketReactionBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  if (reactions.length === 0 && !canReact) return null;

  return (
    <div className="mt-1.5">
      <div className="flex flex-wrap items-center gap-1">
        {reactions.map((r) => (
          <button
            key={r.emoji}
            type="button"
            aria-pressed={r.mine}
            aria-label={`${r.emoji} の反応 ${r.count} 件${r.mine ? '（自分も押しています）' : ''}`}
            onClick={() => onToggle(r.emoji)}
            disabled={!canReact}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs disabled:cursor-default ${
              r.mine
                ? 'border-brand-600 bg-brand-50 text-brand-700'
                : 'border-surface-3 bg-surface-1 text-[var(--color-text-secondary)] hover:bg-surface-2'
            }`}
          >
            <span aria-hidden="true">{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </button>
        ))}
        {canReact && (
          <button
            type="button"
            aria-label="反応を付ける"
            aria-expanded={pickerOpen}
            onClick={() => setPickerOpen((v) => !v)}
            className="ui-hit grid h-6 w-6 place-items-center rounded-full border border-dashed border-surface-3 text-xs text-[var(--color-text-muted)] hover:bg-surface-2"
          >
            ＋
          </button>
        )}
      </div>
      {pickerOpen && (
        <TicketReactionPicker
          onPick={(emoji) => {
            onToggle(emoji);
            setPickerOpen(false);
          }}
        />
      )}
    </div>
  );
}
