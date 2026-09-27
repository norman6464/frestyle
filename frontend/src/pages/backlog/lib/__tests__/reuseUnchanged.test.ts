import { describe, it, expect } from 'vitest';
import { reuseUnchanged } from '../reuseUnchanged';

const a = { id: 'a', title: 'A', labels: [{ id: 'l1' }] };
const b = { id: 'b', title: 'B', labels: [] };

describe('reuseUnchanged', () => {
  it('中身が同じものは前の値をそのまま使う（行の描き直しを起こさない）', () => {
    const next = [{ ...a, labels: [{ id: 'l1' }] }, { ...b }];

    const merged = reuseUnchanged([a, b], next);

    expect(merged[0]).toBe(a);
    expect(merged[1]).toBe(b);
  });

  it('すべて同じで並びも同じなら、前の配列そのものを返す', () => {
    const prev = [a, b];

    expect(reuseUnchanged(prev, [{ ...a }, { ...b }])).toBe(prev);
  });

  it('中身が変わったものだけ新しい値にする', () => {
    const changed = { ...b, title: 'B2' };

    const merged = reuseUnchanged([a, b], [{ ...a }, changed]);

    expect(merged[0]).toBe(a);
    expect(merged[1]).toBe(changed);
  });

  it('並びが変われば新しい配列を返す（要素は使い回す）', () => {
    const prev = [a, b];

    const merged = reuseUnchanged(prev, [{ ...b }, { ...a }]);

    expect(merged).not.toBe(prev);
    expect(merged[0]).toBe(b);
    expect(merged[1]).toBe(a);
  });

  it('増えたもの・減ったものは応答どおり', () => {
    const c = { id: 'c', title: 'C', labels: [] };

    expect(reuseUnchanged([a, b], [{ ...a }, c]).map((t) => t.id)).toEqual(['a', 'c']);
  });
});
