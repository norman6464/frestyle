import { describe, it, expect } from 'vitest';
import { KB_EDGE_RATIO, dropZoneAt, dropZoneFromEvent, toDropTarget } from '../dropZone';

describe('dropZoneAt', () => {
  it('上の端は手前、下の端は直後、その間は子として', () => {
    expect(dropZoneAt(0)).toBe('before');
    expect(dropZoneAt(0.5)).toBe('into');
    expect(dropZoneAt(1)).toBe('after');
  });

  it('境目のちょうど上は中央（子として）に倒す', () => {
    // 端を「未満」で判定しているので、境目そのものは中央に入る。
    // どちらかに倒すこと自体が大事で、揺れると狙って落とせない。
    expect(dropZoneAt(KB_EDGE_RATIO)).toBe('into');
    expect(dropZoneAt(1 - KB_EDGE_RATIO)).toBe('into');
  });

  it('端の幅は上下で同じ', () => {
    expect(dropZoneAt(KB_EDGE_RATIO - 0.01)).toBe('before');
    expect(dropZoneAt(1 - KB_EDGE_RATIO + 0.01)).toBe('after');
  });
});

describe('dropZoneFromEvent', () => {
  it('行の矩形と縦位置から決める', () => {
    const rect = { top: 100, height: 28 };

    expect(dropZoneFromEvent(rect, 102)).toBe('before');
    expect(dropZoneFromEvent(rect, 114)).toBe('into');
    expect(dropZoneFromEvent(rect, 126)).toBe('after');
  });

  it('高さが 0 でも落ちない', () => {
    // 描画前の一瞬など。0 割りで NaN を返すと、どの分岐にも入らず落とせなくなる。
    expect(dropZoneFromEvent({ top: 0, height: 0 }, 10)).toBe('into');
  });
});

describe('toDropTarget', () => {
  it('落下先の種類と行の ID を、木を動かす指定に変える', () => {
    expect(toDropTarget('before', 'p1')).toEqual({ kind: 'before', pageId: 'p1' });
    expect(toDropTarget('into', 'p1')).toEqual({ kind: 'into', pageId: 'p1' });
  });
});
