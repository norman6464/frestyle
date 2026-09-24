import type { Ticket } from '@/entities/ticket';
import type { BacklogGroupModel } from '../ui/BacklogList';

export interface UseBacklogReorderHandlers {
  /** バックログの段の中で 1 つ動かす。 */
  onMove: (ticketId: string, input: { anchorTicketId?: string; anchorAfter?: boolean }) => Promise<void>;
  /** スプリントの段の中で 1 つ動かす（並びはスプリントごとに別に持つ）。 */
  onMoveInSprint?: (ticketId: string, anchorTicketId: string, anchorAfter: boolean) => Promise<void>;
}

export interface BacklogReorder {
  /** 選択中のチケット。一覧に無ければ null（別の絞り込みで消えた等）。 */
  selected: Ticket | null;
  /** 選択中のチケットが入っている段。 */
  ownerGroup: BacklogGroupModel | null;
  isFirst: boolean;
  isLast: boolean;
  /** 入れ先に選べるスプリント（いま入っている段は除く）。 */
  otherSprints: { id: string; name: string }[];
  moveUp: () => Promise<void>;
  moveDown: () => Promise<void>;
  moveLast: () => Promise<void>;
}

/**
 * useBacklogReorder は選択中のチケットを「同じ段の中で」動かす操作を組み立てる。
 *
 * 並び替えは段の中だけ（スプリントとバックログは別の並びを持つ）。段をまたぐ移動は別の操作
 * （スプリントへ入れる／から出す）なので、上下の操作には載せない。
 * 動かせないとき（先頭で上へ等）は何もせず解決する。
 *
 * 一覧と選択から毎回求め直す（手元に状態を持たない）ので、関数も毎回作り直してよい。
 */
export function useBacklogReorder(
  groups: BacklogGroupModel[],
  selectedId: string | null,
  { onMove, onMoveInSprint }: UseBacklogReorderHandlers,
): BacklogReorder {
  const ownerGroup = selectedId ? groups.find((g) => g.tickets.some((t) => t.id === selectedId)) ?? null : null;
  const siblings = ownerGroup?.tickets ?? [];
  const selectedIndex = selectedId ? siblings.findIndex((t) => t.id === selectedId) : -1;
  const selected = selectedIndex >= 0 ? siblings[selectedIndex] : null;
  const isFirst = selectedIndex <= 0;
  const isLast = selectedIndex < 0 || selectedIndex >= siblings.length - 1;

  const moveWithin = async (anchor: Ticket, after: boolean) => {
    if (!selected || !ownerGroup) return;
    if (ownerGroup.kind === 'sprint') {
      await onMoveInSprint?.(selected.id, anchor.id, after);
      return;
    }
    await onMove(selected.id, { anchorTicketId: anchor.id, anchorAfter: after });
  };

  const moveUp = async () => {
    if (isFirst) return;
    await moveWithin(siblings[selectedIndex - 1], false);
  };

  const moveDown = async () => {
    if (isLast) return;
    await moveWithin(siblings[selectedIndex + 1], true);
  };

  const moveLast = async () => {
    if (!selected || !ownerGroup || isLast) return;
    if (ownerGroup.kind === 'sprint') {
      await onMoveInSprint?.(selected.id, siblings[siblings.length - 1].id, true);
      return;
    }
    await onMove(selected.id, {});
  };

  const otherSprints = groups
    .filter((g) => g.kind === 'sprint' && g.id !== ownerGroup?.id)
    .map((g) => ({ id: g.id, name: g.name }));

  return { selected, ownerGroup, isFirst, isLast, otherSprints, moveUp, moveDown, moveLast };
}
