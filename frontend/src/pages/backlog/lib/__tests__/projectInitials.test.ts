import { describe, expect, it } from 'vitest';
import { projectInitials } from '../projectInitials';

describe('projectInitials', () => {
  it('鍵の先頭 2 文字を大文字で', () => {
    expect(projectInitials('frestyle')).toBe('FR');
  });

  it('自動採番の鍵は記号を落としてから取る', () => {
    expect(projectInitials('p-1a2b3c')).toBe('P1');
  });

  it('英数字が無ければ元の 2 文字をそのまま使う', () => {
    expect(projectInitials('開発')).toBe('開発');
  });
});
