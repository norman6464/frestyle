import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLoginCallback } from '../useLoginCallback';

const mockNavigate = vi.fn();
const mockDispatch = vi.fn();

vi.mock('react-router-dom', () => ({
  useSearchParams: () => [new URLSearchParams(mockSearchParams)],
  useNavigate: () => mockNavigate,
}));

vi.mock('@/shared/lib/store', () => ({
  useAppDispatch: () => mockDispatch,
}));

vi.mock('@/entities/user/api/authRepository', () => ({
  default: {
    login: vi.fn(),
  },
}));

vi.mock('@/entities/user/model/authSlice', () => ({
  setAuthData: () => ({ type: 'auth/setAuthData' }),
}));

// 認可を始めたときに置いた値を取り出す側と、Dex とのトークン交換側。テストごとに中身を差し替える。
vi.mock('@/features/auth', () => ({
  consumeAuthFlowState: () => mockFlow,
  exchangeCodeForToken: (...args: unknown[]) => mockExchangeCodeForToken(...args),
  verifyIdTokenNonce: (...args: unknown[]) => mockVerifyIdTokenNonce(...args),
  saveDexSession: (...args: unknown[]) => mockSaveDexSession(...args),
  readAuthConfig: () => mockReadAuthConfig(),
}));

import authRepository from '@/entities/user/api/authRepository';

let mockSearchParams = '';
let mockFlow: { state: string; nonce: string; codeVerifier: string } | null = null;
const mockExchangeCodeForToken = vi.fn();
const mockVerifyIdTokenNonce = vi.fn();
const mockSaveDexSession = vi.fn();
const mockReadAuthConfig = vi.fn();

const FLOW = { state: 'my-state', nonce: 'my-nonce', codeVerifier: 'my-verifier' };
const CONFIGURED = { status: 'configured' as const, tokenUri: 'http://localhost:5556/dex/token' };
const TOKEN = { idToken: 'id-token-1', refreshToken: 'refresh-1', expiresInSeconds: 3600 };

describe('useLoginCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParams = '';
    mockFlow = { ...FLOW };
    mockReadAuthConfig.mockReturnValue(CONFIGURED);
    mockExchangeCodeForToken.mockResolvedValue(TOKEN);
    mockVerifyIdTokenNonce.mockReturnValue(true);
  });

  it('state が一致すれば、検証値を添えて交換する', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    vi.mocked(authRepository.login).mockResolvedValue({ message: 'ログインしました。' });

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockExchangeCodeForToken).toHaveBeenCalledWith(CONFIGURED, 'test-code', 'my-verifier');
  });

  // **この PR の要のひとつ。**
  // state を確かめないと、攻撃者が自分の認可コードを他人のブラウザに踏ませて、
  // 被害者を攻撃者のアカウントでログインさせられる。
  it('state が一致しなければ交換しない', async () => {
    mockSearchParams = 'code=test-code&state=attacker-state';

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { loginError: 'ログインの検証に失敗しました。もう一度お試しください。' },
    });
  });

  it('state が返ってこなければ交換しない', async () => {
    mockSearchParams = 'code=test-code';

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
  });

  // この端末で始めていない認可の戻り（別タブ・別端末で始めた、あるいは仕込まれた URL）。
  it('手元に手続きが残っていなければ交換しない', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    mockFlow = null;

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { loginError: 'ログインの手続きが見つかりませんでした。もう一度お試しください。' },
    });
  });

  it('発行者の設定が無ければ交換しない', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    mockReadAuthConfig.mockReturnValue({ status: 'unconfigured', missing: ['VITE_OIDC_TOKEN_URI'] });

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { loginError: '現在ログインを受け付けていません。' },
    });
  });

  it('交換に成功したら id_token の nonce を確かめてからセッションを保存する', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    vi.mocked(authRepository.login).mockResolvedValue({ message: 'ログインしました。' });

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockVerifyIdTokenNonce).toHaveBeenCalledWith(TOKEN.idToken, 'my-nonce');
    expect(mockSaveDexSession).toHaveBeenCalledWith(TOKEN.idToken, TOKEN.refreshToken, TOKEN.expiresInSeconds);
  });

  // nonce が合わなければ、backend の代わりにここが弾く（backend はもう id_token 交換に立ち会わない）。
  it('nonce が一致しなければセッションを保存せず、案内つきでログイン画面へ戻す', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    mockVerifyIdTokenNonce.mockReturnValue(false);

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockSaveDexSession).not.toHaveBeenCalled();
    expect(authRepository.login).not.toHaveBeenCalled();
    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { loginError: 'ログインの検証に失敗しました。もう一度お試しください。' },
    });
  });

  it('セッション保存後に login() を呼び、認証状態を確定させてホームへ遷移する', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    vi.mocked(authRepository.login).mockResolvedValue({ message: 'ログインしました。' });

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(authRepository.login).toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith({ type: 'auth/setAuthData' });
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('戻り先（fs.postLoginPath）が置いてあれば、ホームではなくそこへ戻り、使い切る', async () => {
    // 招待リンク（/invite）がログインへ送る前に置く値。外部 URL は置けない（postLoginPath の単体テスト）。
    sessionStorage.setItem('fs.postLoginPath', '/invitations');
    mockSearchParams = 'code=test-code&state=my-state';
    vi.mocked(authRepository.login).mockResolvedValue({ message: 'ログインしました。' });

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockNavigate).toHaveBeenCalledWith('/invitations');
    expect(sessionStorage.getItem('fs.postLoginPath')).toBeNull();
  });

  it('トークン交換に失敗したら案内つきでログイン画面へ戻す', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    mockExchangeCodeForToken.mockRejectedValue(new Error('token endpoint returned 400'));

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { loginError: '認証に失敗しました' } });
  });

  it('セッション確立(login())に失敗したら案内つきでログイン画面へ戻す', async () => {
    mockSearchParams = 'code=test-code&state=my-state';
    vi.mocked(authRepository.login).mockRejectedValue(new Error('認証失敗'));

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { loginError: '認証に失敗しました' } });
  });

  it('error が返っていれば交換しない', async () => {
    mockSearchParams = 'error=access_denied&code=test-code&state=my-state';

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login', {
      state: { loginError: '認証エラーが発生しました' },
    });
    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
  });

  it('code も error も無ければログイン画面へ戻す', async () => {
    mockSearchParams = '';

    await act(async () => {
      renderHook(() => useLoginCallback());
    });

    expect(mockNavigate).toHaveBeenCalledWith('/login');
    expect(mockExchangeCodeForToken).not.toHaveBeenCalled();
    expect(mockDispatch).not.toHaveBeenCalled();
  });
});
