import { Button, FieldSelect, FsIcon } from '@/shared/ui';

export interface BacklogSelectionBandProps {
  /** 選択中チケットの表示キー（例 FRESTYLE-457）。 */
  selectedKey: string;
  /** 選択中チケットが入っている段の名前（「バックログ」「スプリント 1」）。 */
  groupName: string | null;
  /** 選択中チケットが段の先頭か（「1 つ上へ」を disable する）。 */
  isFirst: boolean;
  /** 選択中チケットが段の末尾か（「1 つ下へ」「末尾へ」を disable する）。 */
  isLast: boolean;
  /** 並び替えを出すか（アーカイブの面・読むだけの人は出さない）。 */
  canReorder: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveLast: () => void;
  /** 入れ先に選べるスプリント（いま入っている段は除く）。空なら送り先の選択を出さない。 */
  sprints?: { id: string; name: string }[];
  onMoveToSprint?: (sprintId: string) => void;
  /** 選択中のチケットをスプリントから出す。段がスプリントのときだけ渡る。 */
  onRemoveFromSprint?: () => void;
  onDeselect: () => void;
  /** 狭い画面で詳細を全画面で開く。渡すと大きなボタンを出す（設計ボード ST12）。 */
  onOpenDetail?: () => void;
  /** 並び替えの結果（「1 つ上へ動かしました」等）。読み上げに通知する。 */
  message?: string | null;
  /** header は詳細の上の帯、bottom は狭い画面の一覧の下の帯。 */
  variant: 'header' | 'bottom';
}

const REORDER_RULE =
  '並び替えの決まり: 並び替えは同じ段の中だけ（スプリントとバックログは別の並びを持つ）。アーカイブでは出さない';

const reorderButtonClass =
  'inline-flex min-h-9 items-center gap-1 rounded-md border border-surface-3 px-2.5 text-xs font-medium text-[var(--color-text-secondary)] transition-colors duration-fast hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent [@media(pointer:coarse)]:min-h-11';

/**
 * 選択中の帯（設計ボード ST14 の 01「文脈は 1 本の帯へ」）。選択中のチケット・いる段・選択解除と、
 * そのチケットへの並び替え（1 つ上へ / 1 つ下へ / 末尾へ / スプリントへ / スプリントから出す）を
 * 1 か所にまとめる。
 *
 * 広い画面では詳細の上（対象のすぐそば）、狭い画面では一覧の下に出す。並び替えを画面の最下部へ
 * 離して置くと、どの行に効く操作なのかが遠くて読めない。動かした結果は `status` で読み上げにも届ける。
 *
 * 見出しは h2（「選択中 KEY」）。詳細を開いたときのフォーカスの着地点になる。
 */
export default function BacklogSelectionBand({
  selectedKey,
  groupName,
  isFirst,
  isLast,
  canReorder,
  onMoveUp,
  onMoveDown,
  onMoveLast,
  sprints = [],
  onMoveToSprint,
  onRemoveFromSprint,
  onDeselect,
  onOpenDetail,
  message = null,
  variant,
}: BacklogSelectionBandProps) {
  return (
    <div
      className={`flex flex-col gap-2 text-xs ${
        variant === 'bottom' ? 'border-t border-surface-3 bg-surface-2 px-3 py-3 sm:px-4' : 'px-4 py-3'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2
          tabIndex={-1}
          className="min-w-0 rounded-md text-sm text-[var(--color-text-muted)] outline-none [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          選択中 <b className="font-semibold text-[var(--color-text-primary)]">{selectedKey}</b>
          {groupName && <span> · {groupName}</span>}
        </h2>
        <button
          type="button"
          onClick={onDeselect}
          className="inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-medium text-[var(--color-text-secondary)] transition-colors duration-fast hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
        >
          選択解除
          <FsIcon name="x" className="h-3.5 w-3.5" />
        </button>
      </div>

      {onOpenDetail && (
        <Button onClick={onOpenDetail} fullWidth>
          選択した課題をひらく
        </Button>
      )}

      {canReorder && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onMoveUp} disabled={isFirst} className={reorderButtonClass}>
            <FsIcon name="arrow-up" className="h-3.5 w-3.5" />
            1 つ上へ
          </button>
          <button type="button" onClick={onMoveDown} disabled={isLast} className={reorderButtonClass}>
            <FsIcon name="arrow-down" className="h-3.5 w-3.5" />
            1 つ下へ
          </button>
          <button type="button" onClick={onMoveLast} disabled={isLast} className={reorderButtonClass}>
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
              onChange={(value) => {
                if (value) onMoveToSprint(value);
              }}
              options={[{ value: '', label: '選ぶ…' }, ...sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))]}
              className="rounded border-surface-3 bg-surface-1 px-2 text-xs font-normal"
            />
          )}
          {onRemoveFromSprint && (
            <button type="button" onClick={onRemoveFromSprint} className={reorderButtonClass}>
              スプリントから出す
            </button>
          )}
          {/* 仕様の但し書きは常設しない。毎回読むものではないので「?」へ畳む。
              読み上げとキーボードにも決まりそのものが届くよう、本文を名前にしている。 */}
          <span
            className="ml-auto inline-flex h-6 w-6 cursor-help items-center justify-center rounded-full border border-surface-3 text-xs font-bold text-[var(--color-text-muted)] [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9"
            tabIndex={0}
            role="note"
            aria-label={REORDER_RULE}
            title={REORDER_RULE}
          >
            ?
          </span>
        </div>
      )}

      {/* 動かした結果。領域は最初から置いておき、変わったときだけ文字を入れる（後から現れた領域は読み上げが拾わない）。 */}
      <p role="status" aria-live="polite" className={message ? 'text-xs text-[var(--color-text-secondary)]' : 'sr-only'}>
        {message ?? ''}
      </p>
    </div>
  );
}
