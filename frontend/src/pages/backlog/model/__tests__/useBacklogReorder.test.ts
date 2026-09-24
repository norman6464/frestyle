import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Ticket } from '@/entities/ticket';
import type { BacklogGroupModel } from '../../ui/BacklogList';
import { useBacklogReorder } from '../useBacklogReorder';

const ticket = (id: string): Ticket =>
  ({ id, number: Number(id.replace(/\D/g, '')) || 1, title: id, labels: [] }) as unknown as Ticket;

const groups: BacklogGroupModel[] = [
  { id: 'sp-1', kind: 'sprint', name: 'スプリント 1', tickets: [ticket('s1'), ticket('s2'), ticket('s3')] },
  { id: 'sp-2', kind: 'sprint', name: 'スプリント 2', tickets: [] },
  { id: '__backlog__', kind: 'backlog', name: 'バックログ', tickets: [ticket('b1'), ticket('b2')] },
];

function setup(selectedId: string | null) {
  const onMove = vi.fn().mockResolvedValue(undefined);
  const onMoveInSprint = vi.fn().mockResolvedValue(undefined);
  const { result } = renderHook(() => useBacklogReorder(groups, selectedId, { onMove, onMoveInSprint }));
  return { result, onMove, onMoveInSprint };
}

describe('useBacklogReorder', () => {
  it('選択中のチケットが入っている段と、段の中での位置を求める', () => {
    const { result } = setup('s2');
    expect(result.current.selected?.id).toBe('s2');
    expect(result.current.ownerGroup?.id).toBe('sp-1');
    expect(result.current.isFirst).toBe(false);
    expect(result.current.isLast).toBe(false);
    // いま入っている段は入れ先に出さない。
    expect(result.current.otherSprints).toEqual([{ id: 'sp-2', name: 'スプリント 2' }]);
  });

  it('スプリントの段では、隣を基準にスプリントの中で動かす', async () => {
    const { result, onMove, onMoveInSprint } = setup('s2');
    await result.current.moveUp();
    expect(onMoveInSprint).toHaveBeenLastCalledWith('s2', 's1', false);
    await result.current.moveDown();
    expect(onMoveInSprint).toHaveBeenLastCalledWith('s2', 's3', true);
    await result.current.moveLast();
    expect(onMoveInSprint).toHaveBeenLastCalledWith('s2', 's3', true);
    expect(onMove).not.toHaveBeenCalled();
  });

  it('バックログの段では、末尾へは基準なしで動かす', async () => {
    const { result, onMove, onMoveInSprint } = setup('b1');
    await result.current.moveDown();
    expect(onMove).toHaveBeenLastCalledWith('b1', { anchorTicketId: 'b2', anchorAfter: true });
    await result.current.moveLast();
    expect(onMove).toHaveBeenLastCalledWith('b1', {});
    expect(onMoveInSprint).not.toHaveBeenCalled();
  });

  it('先頭で上へ・末尾で下へ・末尾へは何もしない', async () => {
    const first = setup('b1');
    expect(first.result.current.isFirst).toBe(true);
    await first.result.current.moveUp();
    expect(first.onMove).not.toHaveBeenCalled();

    const last = setup('b2');
    expect(last.result.current.isLast).toBe(true);
    await last.result.current.moveDown();
    await last.result.current.moveLast();
    expect(last.onMove).not.toHaveBeenCalled();
  });

  it('一覧に無いチケットを選んでいれば何も動かさない', async () => {
    const { result, onMove, onMoveInSprint } = setup('gone');
    expect(result.current.selected).toBeNull();
    expect(result.current.ownerGroup).toBeNull();
    await result.current.moveUp();
    await result.current.moveDown();
    await result.current.moveLast();
    expect(onMove).not.toHaveBeenCalled();
    expect(onMoveInSprint).not.toHaveBeenCalled();
  });
});
