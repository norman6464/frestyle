import { describe, it, expect } from 'vitest';
import { GLOBAL_NAV_PRIMARY, GLOBAL_NAV_UTILITY, navActive } from '../globalNav';

describe('ナレッジへの導線', () => {
  it('柱の行き先にナレッジがある', () => {
    // 導線が無いと、画面が出来ていても URL を手で打つしかたどり着けない。
    const kb = GLOBAL_NAV_PRIMARY.find((item) => item.id === 'kb');

    expect(kb).toBeDefined();
    expect(kb?.label).toBe('ナレッジ');
    expect(kb?.to).toBe('/kb');
  });

  it('/notes という項目・パスはもう無い（撤去済み）', () => {
    const items = [...GLOBAL_NAV_PRIMARY, ...GLOBAL_NAV_UTILITY];

    expect(items.map((item) => item.id)).not.toContain('notes');
    expect(items.map((item) => item.to)).not.toContain('/notes');
  });

  it('ページの中（/kb/…）にいても選ばれた状態になる', () => {
    const kb = GLOBAL_NAV_PRIMARY.find((item) => item.id === 'kb');

    expect(navActive(kb!, '/kb')).toBe(true);
    expect(navActive(kb!, '/kb/3ca2c0de-0000-0000-0000-000000000000')).toBe(true);
    expect(navActive(kb!, '/courses')).toBe(false);
  });

  it('名前が前方一致するだけの別パスでは選ばれない', () => {
    // 素の startsWith だと /kb-other でも「ナレッジ」が光ってしまう。
    // いまそういうルートは無いが、足した瞬間に静かに壊れる形なので判定側で塞ぐ。
    const kb = GLOBAL_NAV_PRIMARY.find((item) => item.id === 'kb');

    expect(navActive(kb!, '/kb-other')).toBe(false);
    expect(navActive(kb!, '/px')).toBe(false);
    expect(navActive(kb!, '/profile')).toBe(false);
  });

  it('バックログにいるときナレッジは光らない（URL が /kb の下でも別の面）', () => {
    const kb = GLOBAL_NAV_PRIMARY.find((item) => item.id === 'kb');
    const backlog = GLOBAL_NAV_PRIMARY.find((item) => item.id === 'backlog');

    expect(navActive(kb!, '/backlog/p-1')).toBe(false);
    expect(navActive(backlog!, '/backlog/p-1')).toBe(true);
    expect(navActive(backlog!, '/tickets/t-1')).toBe(true);
  });
});
