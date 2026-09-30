import { Menu } from '@base-ui/react/menu';
import { FsIcon } from '@/shared/ui';

export interface BacklogRowMenuProps {
  /** 読み上げ用にボタンの名前へ含める（「〈題名〉の操作」）。 */
  ticketTitle: string;
  /** 段の先頭か（「1 つ上へ」を disable する）。 */
  isFirst: boolean;
  /** 段の末尾か（「1 つ下へ」「末尾へ」を disable する）。 */
  isLast: boolean;
  /** いまスプリントに入っているか（「スプリントから出す」を出すかどうか）。 */
  inSprint: boolean;
  /** 入れ先に選べるスプリント（いま入っている段は除く）。空なら送り先の項目を出さない。 */
  otherSprints: { id: string; name: string }[];
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveLast: () => void;
  onMoveToSprint: (sprintId: string) => void;
  onRemoveFromSprint: () => void;
}

const itemClass =
  'flex min-h-11 cursor-pointer items-center rounded-md px-2 text-sm text-[var(--color-text-primary)] outline-none data-[highlighted]:bg-surface-2 data-[disabled]:cursor-not-allowed data-[disabled]:text-[var(--color-text-faint)] data-[disabled]:hover:bg-transparent';

/**
 * 一覧の行の並び替え（設計ボード ST08 の並び替え）。行ごとの「…」に畳む —— 常設のボタン列や
 * 選択して開く帯は持たない（バックログの画面では、動かす行を直接押すだけで動かせるようにする）。
 *
 * 中身は同じ段の中の移動（1 つ上へ・1 つ下へ・末尾へ）と、段をまたぐ移動（スプリントへ入れる・
 * スプリントから出す）。並び替えは同じ段の中だけ（スプリントとバックログは別の並びを持つ）ので、
 * 「1 つ上へ」等はここでは常に「いま入っている段の中で」の意味になる。
 *
 * キーボード移動・外側クリック・フォーカス復帰は Base UI が扱う（HeaderUserMenu と同じ)。
 */
export default function BacklogRowMenu({
  ticketTitle,
  isFirst,
  isLast,
  inSprint,
  otherSprints,
  onMoveUp,
  onMoveDown,
  onMoveLast,
  onMoveToSprint,
  onRemoveFromSprint,
}: BacklogRowMenuProps) {
  const showSprintSection = inSprint || otherSprints.length > 0;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={`${ticketTitle} の操作`}
        onClick={(event) => event.stopPropagation()}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[var(--color-text-muted)] transition-colors hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11"
      >
        <FsIcon name="more" className="h-4 w-4" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="end" className="z-50">
          <Menu.Popup className="w-48 overflow-hidden rounded-lg border border-[var(--fs-menu-border)] bg-[var(--fs-menu-surface)] p-1 shadow-lg focus:outline-none">
            <Menu.Item disabled={isFirst} onClick={onMoveUp} className={itemClass}>
              1 つ上へ
            </Menu.Item>
            <Menu.Item disabled={isLast} onClick={onMoveDown} className={itemClass}>
              1 つ下へ
            </Menu.Item>
            <Menu.Item disabled={isLast} onClick={onMoveLast} className={itemClass}>
              末尾へ
            </Menu.Item>
            {showSprintSection && (
              <>
                <Menu.Separator className="my-1 h-px bg-[var(--fs-menu-border)]" />
                {otherSprints.map((sprint) => (
                  <Menu.Item key={sprint.id} onClick={() => onMoveToSprint(sprint.id)} className={itemClass}>
                    <span className="min-w-0 truncate">{sprint.name} へ入れる</span>
                  </Menu.Item>
                ))}
                {inSprint && (
                  <Menu.Item onClick={onRemoveFromSprint} className={itemClass}>
                    スプリントから出す
                  </Menu.Item>
                )}
              </>
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
