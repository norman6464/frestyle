import { describe, expect, it } from 'vitest';
import { loginErrorRedirect, readLoginError } from '../loginRedirect';

describe('loginRedirect', () => {
  it('渡した理由を、ログイン画面が読める形で包む', () => {
    const { state } = loginErrorRedirect('認証に失敗しました');
    expect(readLoginError(state)).toBe('認証に失敗しました');
  });

  it('理由が無い・形が違う state は null にする', () => {
    expect(readLoginError(null)).toBeNull();
    expect(readLoginError(undefined)).toBeNull();
    expect(readLoginError({ toast: '古い鍵' })).toBeNull();
    expect(readLoginError({ loginError: '' })).toBeNull();
    expect(readLoginError({ loginError: 42 })).toBeNull();
  });
});
