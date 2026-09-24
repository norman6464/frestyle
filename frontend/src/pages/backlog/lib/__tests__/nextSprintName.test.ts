import { describe, expect, it } from 'vitest';
import { nextSprintName } from '../nextSprintName';

describe('nextSprintName', () => {
  it('1 本も無ければ「スプリント 1」', () => {
    expect(nextSprintName([])).toBe('スプリント 1');
  });

  it('連番どおりなら件数 + 1', () => {
    expect(nextSprintName([{ name: 'スプリント 1' }, { name: 'スプリント 2' }])).toBe('スプリント 3');
  });

  it('途中を消して番号が飛んでいても、既にある名前とは重ねない', () => {
    // 1 と 3 が残っている。件数 + 1 の「スプリント 3」は既にあるので 4 にする。
    expect(nextSprintName([{ name: 'スプリント 1' }, { name: 'スプリント 3' }])).toBe('スプリント 4');
  });

  it('利用者が付けた名前は数えるだけで、番号の決め方には関わらない', () => {
    expect(nextSprintName([{ name: '9 月前半' }, { name: '9 月後半' }])).toBe('スプリント 3');
  });

  it('前後の空白は同じ名前として扱う', () => {
    expect(nextSprintName([{ name: ' スプリント 2 ' }])).toBe('スプリント 3');
  });
});
