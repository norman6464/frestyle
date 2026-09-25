import { describe, expect, it } from 'vitest';
import { FirebaseError } from 'firebase/app';
import { classifyFirebaseError, classifyFirebaseErrorField } from '../firebaseErrorMessage';

const firebaseError = (code: string) => new FirebaseError(code, 'stub');

describe('classifyFirebaseError', () => {
  it('既知のコードは日本語の文言にし、知らないものは fallback にする', () => {
    expect(classifyFirebaseError(firebaseError('auth/weak-password'), 'x')).toBe('パスワードは 6 文字以上にしてください。');
    expect(classifyFirebaseError(firebaseError('auth/unknown-code'), '失敗しました')).toBe('失敗しました');
    expect(classifyFirebaseError(new Error('plain'), '失敗しました')).toBe('失敗しました');
  });
});

describe('classifyFirebaseErrorField', () => {
  it('欄の直しで解ける失敗はその欄を返す', () => {
    expect(classifyFirebaseErrorField(firebaseError('auth/invalid-email'))).toBe('email');
    expect(classifyFirebaseErrorField(firebaseError('auth/email-already-in-use'))).toBe('email');
    expect(classifyFirebaseErrorField(firebaseError('auth/missing-email'))).toBe('email');
    expect(classifyFirebaseErrorField(firebaseError('auth/weak-password'))).toBe('password');
    expect(classifyFirebaseErrorField(firebaseError('auth/missing-password'))).toBe('password');
  });

  it('メールかパスワードのどちらかが違う失敗は欄に寄せない（登録の有無を漏らさない）', () => {
    expect(classifyFirebaseErrorField(firebaseError('auth/invalid-credential'))).toBeNull();
    expect(classifyFirebaseErrorField(firebaseError('auth/too-many-requests'))).toBeNull();
    expect(classifyFirebaseErrorField(new Error('plain'))).toBeNull();
  });
});
