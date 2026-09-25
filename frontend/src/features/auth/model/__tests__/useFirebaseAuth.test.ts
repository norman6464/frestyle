import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { FirebaseError } from 'firebase/app';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  sendPasswordResetEmail,
  sendEmailVerification,
} from 'firebase/auth';
import { useFirebaseAuth } from '../useFirebaseAuth';

vi.mock('firebase/auth', async () => {
  const actual = await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
  return {
    ...actual,
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    signInWithPopup: vi.fn(),
    sendPasswordResetEmail: vi.fn(),
    sendEmailVerification: vi.fn(),
  };
});

vi.mock('@/shared/lib/auth/firebaseApp', () => ({
  getFirebaseAuth: vi.fn(() => ({ /* フェイクの Auth インスタンス */ })),
}));

const complete = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'frestyle-507912.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'frestyle-507912',
};

function stubConfigured() {
  for (const [k, v] of Object.entries(complete)) vi.stubEnv(k, v);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe('useFirebaseAuth', () => {
  it('設定が欠けていれば available:false で missing を返す', () => {
    const { result } = renderHook(() => useFirebaseAuth());
    expect(result.current.available).toBe(false);
    if (!result.current.available) {
      expect(result.current.missing).toContain('VITE_FIREBASE_API_KEY');
    }
  });

  it('設定が揃っていれば available:true で4つの操作を返す', () => {
    stubConfigured();
    const { result } = renderHook(() => useFirebaseAuth());
    expect(result.current.available).toBe(true);
    if (result.current.available) {
      expect(typeof result.current.signInWithEmail).toBe('function');
      expect(typeof result.current.signUpWithEmail).toBe('function');
      expect(typeof result.current.signInWithGoogle).toBe('function');
      expect(typeof result.current.sendPasswordReset).toBe('function');
    }
  });

  it('signInWithEmail: 成功したら true を返しエラーは立たない', async () => {
    stubConfigured();
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({} as never);
    const { result } = renderHook(() => useFirebaseAuth());

    let ok = false;
    await act(async () => {
      if (result.current.available) {
        ok = await result.current.signInWithEmail('u@example.com', 'password123');
      }
    });

    expect(ok).toBe(true);
    if (result.current.available) {
      expect(result.current.errorMessage).toBeNull();
    }
  });

  // auth/wrong-password と auth/user-not-found は列挙攻撃対策で同じ文言にまとめる
  // （どちらのエラーだったかを利用者に教えると「登録済みかどうか」の探索に使われる）。
  it('signInWithEmail: invalid-credential は「メールアドレスまたはパスワードが正しくありません」', async () => {
    stubConfigured();
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
      new FirebaseError('auth/invalid-credential', 'invalid'),
    );
    const { result } = renderHook(() => useFirebaseAuth());

    let ok = true;
    await act(async () => {
      if (result.current.available) {
        ok = await result.current.signInWithEmail('u@example.com', 'wrong');
      }
    });

    expect(ok).toBe(false);
    if (result.current.available) {
      expect(result.current.errorMessage).toBe('メールアドレスまたはパスワードが正しくありません。');
      // どちらが違うかは言わない（登録の有無を漏らさない）ので、欄には寄せない。
      expect(result.current.errorField).toBeNull();
    }
  });

  it('signUpWithEmail: 既に使われているメールアドレスなら専用メッセージを出す', async () => {
    stubConfigured();
    vi.mocked(createUserWithEmailAndPassword).mockRejectedValue(
      new FirebaseError('auth/email-already-in-use', 'in use'),
    );
    const { result } = renderHook(() => useFirebaseAuth());

    let ok = true;
    await act(async () => {
      if (result.current.available) {
        ok = await result.current.signUpWithEmail('u@example.com', 'password123');
      }
    });

    expect(ok).toBe(false);
    if (result.current.available) {
      expect(result.current.errorMessage).toBe('このメールアドレスは既に登録されています。');
      // メールの欄の直しで解ける失敗なので、メールの欄に寄せる。
      expect(result.current.errorField).toBe('email');
    }
  });

  it('signUpWithEmail: 成功したら確認メールを送る', async () => {
    stubConfigured();
    const fakeUser = { uid: 'u1' };
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({ user: fakeUser } as never);
    vi.mocked(sendEmailVerification).mockResolvedValue(undefined);
    const { result } = renderHook(() => useFirebaseAuth());

    let ok = false;
    await act(async () => {
      if (result.current.available) {
        ok = await result.current.signUpWithEmail('u@example.com', 'password123');
      }
    });

    expect(ok).toBe(true);
    expect(sendEmailVerification).toHaveBeenCalledWith(fakeUser);
  });

  // backend は email_verified を確認できるまでアドレスを保存しない。確認メールが
  // 送れなくてもアカウント作成自体は完了させる（次回ログイン時に再送・再検証の余地を残す）。
  it('signUpWithEmail: 確認メールの送信に失敗してもアカウント作成は成功のまま', async () => {
    stubConfigured();
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({ user: { uid: 'u1' } } as never);
    vi.mocked(sendEmailVerification).mockRejectedValue(new Error('smtp down'));
    const { result } = renderHook(() => useFirebaseAuth());

    let ok = false;
    await act(async () => {
      if (result.current.available) {
        ok = await result.current.signUpWithEmail('u@example.com', 'password123');
      }
    });

    expect(ok).toBe(true);
  });

  it('signInWithGoogle: ポップアップが閉じられたら案内文言を出す', async () => {
    stubConfigured();
    vi.mocked(signInWithPopup).mockRejectedValue(
      new FirebaseError('auth/popup-closed-by-user', 'closed'),
    );
    const { result } = renderHook(() => useFirebaseAuth());

    let ok = true;
    await act(async () => {
      if (result.current.available) {
        ok = await result.current.signInWithGoogle();
      }
    });

    expect(ok).toBe(false);
    if (result.current.available) {
      expect(result.current.errorMessage).toBe('ログインがキャンセルされました。');
    }
  });

  it('sendPasswordReset: 成功したら true を返す', async () => {
    stubConfigured();
    vi.mocked(sendPasswordResetEmail).mockResolvedValue(undefined);
    const { result } = renderHook(() => useFirebaseAuth());

    let ok = false;
    await act(async () => {
      if (result.current.available) {
        ok = await result.current.sendPasswordReset('u@example.com');
      }
    });

    expect(ok).toBe(true);
  });

  it('多重送信を防ぐ: 実行中に再度呼んでも2回目は無視される', async () => {
    stubConfigured();
    let resolveFirst: () => void = () => {};
    vi.mocked(signInWithEmailAndPassword).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = () => resolve({} as never);
        }),
    );
    const { result } = renderHook(() => useFirebaseAuth());

    let firstCall: Promise<boolean> | undefined;
    let secondResult: boolean | undefined;
    await act(async () => {
      if (result.current.available) {
        firstCall = result.current.signInWithEmail('u@example.com', 'password123');
      }
    });
    await act(async () => {
      if (result.current.available) {
        secondResult = await result.current.signInWithEmail('u@example.com', 'password123');
      }
    });

    expect(secondResult).toBe(false);
    expect(vi.mocked(signInWithEmailAndPassword)).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFirst();
      await firstCall;
    });
  });
});
