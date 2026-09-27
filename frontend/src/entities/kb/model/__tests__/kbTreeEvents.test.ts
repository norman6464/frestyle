import { describe, it, expect, vi } from 'vitest';
import { emitKbTreeEvent, subscribeKbTreeEvents } from '../kbTreeEvents';
import type { KbPage } from '../types';

const page: KbPage = {
  id: 'p1',
  spaceId: 's1',
  title: '設計メモ',
  createdByUserId: 1,
  createdAt: '2026-08-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
};

describe('kbTreeEvents', () => {
  it('購読者へイベントが届き、解除後は届かない', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeKbTreeEvents(listener);

    emitKbTreeEvent({ type: 'page-updated', page });
    expect(listener).toHaveBeenCalledWith({ type: 'page-updated', page });

    unsubscribe();
    emitKbTreeEvent({ type: 'page-updated', page });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('購読者がいなくても emit は失敗しない', () => {
    expect(() => emitKbTreeEvent({ type: 'page-updated', page })).not.toThrow();
  });

  it('emit の最中に後続の購読者が解除されても、その回のイベントは届く', () => {
    // 生の Set を走査していると、未訪問の要素を走査中に消した時点で飛ばされる。
    // 写しを回している証拠として、first が second を解除しても second に届くことを見る。
    const second = vi.fn();
    const first = vi.fn(() => unsubscribeSecond());
    const unsubscribeFirst = subscribeKbTreeEvents(first);
    const unsubscribeSecond = subscribeKbTreeEvents(second);

    emitKbTreeEvent({ type: 'page-updated', page });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    unsubscribeFirst();
  });
});
