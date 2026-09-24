import { FieldSelect, FsIcon } from '@/shared/ui';

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

const REORDER_RULE =
  '並び替えの決まり: 並び替えは同じ段の中だけ（スプリントとバックログは別の並びを持つ）。アーカイブでは出さない';

/**
 * 一覧の下の帯。「選択中 X を 1つ上へ / 1つ下へ / 末尾へ」（設計 Ⅳ-F・見本どおり）。
 * ドラッグ&ドロップは段2（キーボードだけで完結し、依存を増やさないボタン案を採用）。
 *
 * 行を選んでいないときは何も描かない。押せない 3 つのボタンと案内文が常に居座るより、
 * 選んだ瞬間に対象のキーと段の名前ごと現れる方が「何に効く操作か」が読める（設計ボード ST12）。
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
  if (!hasSelection) return null;
  return (
    <div className="flex max-h-48 shrink-0 flex-wrap items-center gap-2 overflow-y-auto border-t border-surface-3 bg-surface-1 px-3 py-2 text-xs [&_button]:min-h-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600 [&_select]:min-h-11">
      <span className="min-w-0 text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
        選択中 <b className="text-[var(--color-text-primary)]">{selectedKey}</b> を
        {groupName && <>（{groupName} の中で）</>}
      </span>
      <button
        type="button"
        onClick={onMoveUp}
        disabled={!hasSelection || isFirst}
        className="inline-flex items-center gap-1 rounded-md border border-surface-3 px-2.5 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <FsIcon name="arrow-up" className="h-3.5 w-3.5" />
        1 つ上へ
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={!hasSelection || isLast}
        className="inline-flex items-center gap-1 rounded-md border border-surface-3 px-2.5 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <FsIcon name="arrow-down" className="h-3.5 w-3.5" />
        1 つ下へ
      </button>
      <button
        type="button"
        onClick={onMoveLast}
        disabled={!hasSelection || isLast}
        className="inline-flex items-center gap-1 rounded-md border border-surface-3 px-2.5 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
      >
        <FsIcon name="chevron-double-down" className="h-3.5 w-3.5" />
        末尾へ
      </button>
      {onMoveToSprint && sprints.length > 0 && (
        /* value は空のまま持たない。ここに「現在値」は無く、選んだ瞬間が操作なので、
           毎回「選ぶ…」へ戻って同じスプリントへ続けて入れられる。 */
        <FieldSelect
          label="入れ先のスプリント"
          prefix="スプリントへ"
          value=""
          disabled={!hasSelection}
          onChange={(value) => {
            if (value) onMoveToSprint(value);
          }}
          options={[
            { value: '', label: '選ぶ…' },
            ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name })),
          ]}
          className="rounded border-surface-3 bg-surface-1 px-2 text-xs font-normal"
        />
      )}
      {onRemoveFromSprint && (
        <button
          type="button"
          onClick={onRemoveFromSprint}
          disabled={!hasSelection}
          className="inline-flex items-center rounded-md border border-surface-3 px-2.5 py-1 font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
        >
          スプリントから出す
        </button>
      )}
      {/* 仕様の但し書きは常設しない。毎回読むものではないので「?」へ畳む。
          ただし中身を title だけに置くとホバーでしか読めない —— 読み上げとキーボードにも
          決まりそのものが届くよう、短い見出しではなく本文を名前にしている。 */}
      <span
        className="ui-hit ml-auto inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full border border-surface-3 text-xs font-bold text-[var(--color-text-muted)]"
        tabIndex={0}
        role="note"
        aria-label={REORDER_RULE}
        title={REORDER_RULE}
      >
        ?
      </span>
    </div>
  );
}
