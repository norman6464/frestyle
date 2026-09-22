export interface BacklogReorderBarProps {
  /** 選択中チケットの表示キー（例 FRESTYLE-457）。未選択なら null。 */
  selectedKey: string | null;
  /** 選択中チケットが入っている段の名前（「スプリント 1 の中で」と出すため）。 */
  groupName?: string | null;
  /** 選択中チケットが段の先頭か（「1つ上へ」を disable する）。 */
  isFirst: boolean;
  /** 選択中チケットが段の末尾か（「1つ下へ」「末尾へ」を disable する）。 */
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveLast: () => void;
  /**
   * 入れ先に選べるスプリント（計画中・進行中だけ。いま入っている段は除く）。空なら送り先の
   * 選択そのものを出さない —— 押せるのに何も選べない選択肢を置かないため。
   */
  sprints?: { id: string; name: string }[];
  /** 選択中のチケットをスプリントへ入れる。 */
  onMoveToSprint?: (sprintId: string) => void;
  /** 選択中のチケットをスプリントから出す（バックログへ戻る）。段がスプリントのときだけ渡る。 */
  onRemoveFromSprint?: () => void;
}

const ICON_PROPS = {
  width: 12,
  height: 12,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.4,
  strokeLinecap: 'round' as const,
  'aria-hidden': true,
};

/**
 * 一覧の下の帯。「選択中 X を 1つ上へ / 1つ下へ / 末尾へ」（設計 Ⅳ-F・見本どおり）。
 * ドラッグ&ドロップは段2（キーボードだけで完結し、依存を増やさないボタン案を採用）。
 */
export default function BacklogReorderBar({
  selectedKey,
  groupName = null,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  onMoveLast,
  sprints = [],
  onMoveToSprint,
  onRemoveFromSprint,
}: BacklogReorderBarProps) {
  const hasSelection = selectedKey !== null;
  if (!hasSelection) return <p className="border-t border-surface-3 px-4 py-3 text-xs text-[var(--color-text-muted)]">行を選ぶと並び替えられます</p>;
  return (
    <div className="flex max-h-48 shrink-0 flex-wrap items-center gap-2 overflow-y-auto border-t border-surface-3 bg-surface-1 px-3 py-2 text-xs [&_button]:min-h-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600 [&_select]:min-h-11">
      <span className="min-w-0 text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
        {hasSelection ? (
          <>
            選択中 <b className="text-[var(--color-text-primary)]">{selectedKey}</b> を
            {groupName && <>（{groupName} の中で）</>}
          </>
        ) : (
          '行を選ぶと並び替えられます'
        )}
      </span>
      <button
        type="button"
        onClick={onMoveUp}
        disabled={!hasSelection || isFirst}
        className="inline-flex items-center gap-1 rounded border border-surface-3 px-2 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <svg {...ICON_PROPS}>
          <path d="m5 12 7-7 7 7" />
          <path d="M12 19V5" />
        </svg>
        1 つ上へ
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={!hasSelection || isLast}
        className="inline-flex items-center gap-1 rounded border border-surface-3 px-2 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <svg {...ICON_PROPS}>
          <path d="M12 5v14" />
          <path d="m19 12-7 7-7-7" />
        </svg>
        1 つ下へ
      </button>
      <button
        type="button"
        onClick={onMoveLast}
        disabled={!hasSelection || isLast}
        className="inline-flex items-center gap-1 rounded border border-surface-3 px-2 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <svg {...ICON_PROPS}>
          <path d="m7 6 5 5 5-5" />
          <path d="m7 13 5 5 5-5" />
        </svg>
        末尾へ
      </button>
      {onMoveToSprint && sprints.length > 0 && (
        <label className="flex items-center gap-1.5 text-[var(--color-text-muted)]">
          スプリントへ
          <select
            aria-label="入れ先のスプリント"
            value=""
            disabled={!hasSelection}
            onChange={(e) => {
              if (e.target.value === '') return;
              onMoveToSprint(e.target.value);
              // 選び直せるよう毎回空へ戻す（同じスプリントへ続けて入れられるように）。
              e.target.value = '';
            }}
            className="rounded border border-surface-3 bg-surface-1 px-1.5 py-1 text-xs text-[var(--color-text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <option value="">選ぶ…</option>
            {sprints.map((sprint) => (
              <option key={sprint.id} value={sprint.id}>
                {sprint.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {onRemoveFromSprint && (
        <button
          type="button"
          onClick={onRemoveFromSprint}
          disabled={!hasSelection}
          className="inline-flex items-center rounded border border-surface-3 px-2 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          スプリントから出す
        </button>
      )}
      {/* 仕様の但し書きは常設しない。毎回読むものではないので「?」へ畳み、
          知りたい人だけがホバー／フォーカスで読めるようにする。 */}
      <span
        className="ml-auto inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-surface-3 text-[10px] font-bold text-[var(--color-text-muted)]"
        tabIndex={0}
        role="note"
        aria-label="並び替えの決まり"
        title="並び替えは同じ段の中だけ（スプリントとバックログは別の並びを持つ）。アーカイブでは出さない"
      >
        ?
      </span>
    </div>
  );
}
