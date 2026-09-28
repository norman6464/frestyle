import { describe, expect, it } from 'vitest';
import { buildInviteUrl, readInviteToken } from '../invitationLink';

describe('招待リンク', () => {
  it('フラグメントにトークンを載せ、同じ関数で読み戻せる', () => {
    const url = buildInviteUrl('https://frestyle.dev', '3q2-7uMBEjRWeJq83vzMzQ');
    expect(url).toBe('https://frestyle.dev/invite#t=3q2-7uMBEjRWeJq83vzMzQ');
    expect(readInviteToken(new URL(url).hash)).toBe('3q2-7uMBEjRWeJq83vzMzQ');
  });

  it('クエリには載せない（サーバーのログに残さない）', () => {
    expect(new URL(buildInviteUrl('https://frestyle.dev', 'abc')).search).toBe('');
  });

  it('URL に使えない文字はエスケープして往復する', () => {
    const token = 'a+b/c=d&e';
    expect(readInviteToken(new URL(buildInviteUrl('http://localhost:5173', token)).hash)).toBe(token);
  });

  it('トークンが無ければ null', () => {
    expect(readInviteToken('')).toBeNull();
    expect(readInviteToken('#')).toBeNull();
    expect(readInviteToken('#t=')).toBeNull();
    expect(readInviteToken('#other=1')).toBeNull();
    expect(readInviteToken('t=abc')).toBe('abc');
  });
});
