import { AxiosError } from 'axios';
import { describe, expect, it } from 'vitest';
import { formatInvitationDate, inviteFailure } from '../invitationMessages';

function apiError(status: number, serverCode?: string): AxiosError {
  return new AxiosError(
    'stub',
    undefined,
    undefined,
    undefined,
    // @ts-expect-error -- テスト用に最小限だけ埋める。
    { status, data: serverCode ? { error: serverCode } : {}, statusText: '', headers: {}, config: {} },
  );
}

describe('inviteFailure', () => {
  it('メールアドレスの形（400）は欄の下に出す', () => {
    expect(inviteFailure(apiError(400, 'invalid_request'))).toMatchObject({ where: 'email' });
  });

  it('上限と間隔（429）は種類ごとにフォームの帯に出す', () => {
    expect(inviteFailure(apiError(429, 'resend_too_soon'))).toEqual({ where: 'form', text: expect.stringContaining('10 分以内') });
    expect(inviteFailure(apiError(429, 'invitation_email_limit'))).toEqual({ where: 'form', text: expect.stringContaining('1 日 5 件') });
    expect(inviteFailure(apiError(429, 'invitation_daily_limit'))).toEqual({ where: 'form', text: expect.stringContaining('50 件') });
  });

  it('承諾待ちの上限（409）は帯、結果が出ている（409）と無い（404）はトースト', () => {
    expect(inviteFailure(apiError(409, 'too_many_open_invitations'))).toMatchObject({ where: 'form' });
    expect(inviteFailure(apiError(409, 'invitation_not_open'))).toMatchObject({ where: 'toast' });
    expect(inviteFailure(apiError(404, 'not_found'))).toMatchObject({ where: 'toast' });
  });

  it('それ以外は汎用の文言でトースト', () => {
    expect(inviteFailure(apiError(500))).toEqual({ where: 'toast', text: '操作に失敗しました。もう一度お試しください。' });
    expect(inviteFailure(new Error('network'))).toMatchObject({ where: 'toast' });
  });
});

describe('formatInvitationDate', () => {
  it('月日だけにする（読む人のタイムゾーンで）', () => {
    // 固定の ISO 文字列だと CI（UTC）と手元（JST）で日付が変わる。その環境の 9/30 0:00 から作る。
    expect(formatInvitationDate(new Date(2026, 8, 30, 0, 0, 0).toISOString())).toBe('9月30日');
  });

  it('読めない値は空文字', () => {
    expect(formatInvitationDate('not-a-date')).toBe('');
  });
});
