import { describe, it, expect } from 'vitest';
import { MAIN_NAV_ITEMS, navActive } from '../navigation';

describe('ナレッジへの導線', () => {
  it('主要ナビにナレッジがある', () => {
    // 導線が無いと、画面が出来ていても URL を手で打つしかたどり着けない。
    const kb = MAIN_NAV_ITEMS.find((item) => item.id === 'kb');

    expect(kb).toBeDefined();
    expect(kb?.label).toBe('ナレッジ');
    expect(kb?.to).toBe('/kb');
  });

  it('/notes という項目・パスはもう無い（撤去済み）', () => {
    const ids = MAIN_NAV_ITEMS.map((item) => item.id);
    const paths = MAIN_NAV_ITEMS.map((item) => item.to);

    expect(ids).not.toContain('notes');
    expect(paths).not.toContain('/notes');
  });

  it('ページの中（/kb/…）にいても選ばれた状態になる', () => {
    const kb = MAIN_NAV_ITEMS.find((item) => item.id === 'kb');

    expect(navActive(kb!, '/kb')).toBe(true);
    expect(navActive(kb!, '/kb/3ca2c0de-0000-0000-0000-000000000000')).toBe(true);
    expect(navActive(kb!, '/courses')).toBe(false);
  });

  it('名前が前方一致するだけの別パスでは選ばれない', () => {
    // 素の startsWith だと /kb-other でも「ナレッジ」が光ってしまう。
    // いまそういうルートは無いが、足した瞬間に静かに壊れる形なので判定側で塞ぐ。
    const kb = MAIN_NAV_ITEMS.find((item) => item.id === 'kb');

    expect(navActive(kb!, '/kb-other')).toBe(false);
    expect(navActive(kb!, '/px')).toBe(false);
    expect(navActive(kb!, '/profile')).toBe(false);
  });
});
