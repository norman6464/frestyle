import { describe, expect, it } from 'vitest';
import { isAppPath } from '../linkPath';

describe('isAppPath', () => {
  it('アプリ内の相対パスは通す', () => {
    expect(isAppPath('/tickets/abc')).toBe(true);
    expect(isAppPath('/kb/spaces/1?tab=pages')).toBe(true);
    expect(isAppPath('/')).toBe(true);
  });

  it('空・外部 URL・スキーム相対・バックスラッシュ始まり・相対名は弾く（backend の CHECK と同じ 4 種）', () => {
    expect(isAppPath('')).toBe(false);
    expect(isAppPath('//evil.example')).toBe(false);
    expect(isAppPath('https://evil.example')).toBe(false);
    expect(isAppPath('/\\evil')).toBe(false);
    expect(isAppPath('invitations')).toBe(false);
  });
});
