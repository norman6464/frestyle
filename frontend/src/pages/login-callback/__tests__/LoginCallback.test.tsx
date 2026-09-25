import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import LoginCallback from '../ui/LoginCallback';
import authReducer from '@/entities/user/model/authSlice';
import authRepository from '@/entities/user/api/authRepository';
import { ToastProvider } from '@/app/providers/ToastProvider';
import { createMockStorage } from '@/test/mockStorage';

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock('@/entities/user/api/authRepository');

// Dex とのトークン交換。実装（shared/lib/auth/oidcAuthUrl）と挙動をここで模す。
const mockExchangeCodeForToken = vi.fn();
vi.mock('@/features/auth', async () => {
  const actual = await vi.importActual<typeof import('@/features/auth')>('@/features/auth');
  return {
    ...actual,
    exchangeCodeForToken: (...args: unknown[]) => mockExchangeCodeForToken(...args),
    readAuthConfig: () => ({
      status: 'configured',
      authorizeUri: 'http://localhost:5556/dex/auth',
      tokenUri: 'http://localhost:5556/dex/token',
      clientId: 'frestyle-web',
      redirectUri: 'http://localhost:5173/login/callback',
      scope: 'openid profile email offline_access',
    }),
  };
});

// 認可を始めたときにブラウザが置く値。実装（shared/lib/auth/oidcAuthUrl）と同じ鍵を使う。
const FLOW = { state: 'test-state', nonce: 'test-nonce', codeVerifier: 'test-verifier' };

/** verifyIdTokenNonce が読める最小限の JWT（nonce クレームだけを持つ）。 */
function fakeIdToken(nonce: string): string {
  const encode = (obj: unknown) => {
    const bytes = new TextEncoder().encode(JSON.stringify(obj));
    const binary = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  return `${encode({ alg: 'none' })}.${encode({ nonce })}.`;
}

const TOKEN = { idToken: fakeIdToken(FLOW.nonce), refreshToken: 'refresh-1', expiresInSeconds: 3600 };

function seedAuthFlow() {
  sessionStorage.setItem('oidc.authFlow', JSON.stringify(FLOW));
}

function renderWithRoute(search: string) {
  const store = configureStore({ reducer: { auth: authReducer } });
  const view = render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[`/login/callback${search}`]}>
        <ToastProvider>
          <LoginCallback />
        </ToastProvider>
      </MemoryRouter>
    </Provider>,
  );
  return { ...view, store };
}

describe('LoginCallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
    // saveDexSession（実装をそのまま使う）が localStorage を書く。FreStyle では
    // jsdom の localStorage を都度スタブする方針（src/test/mockStorage.ts 参照）。
    vi.stubGlobal('localStorage', createMockStorage());
    sessionStorage.clear();
    seedAuthFlow();
    mockExchangeCodeForToken.mockResolvedValue(TOKEN);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('ローディング表示がされる', () => {
    vi.mocked(authRepository.login).mockResolvedValue({ message: 'ログインしました。' });

    renderWithRoute('?code=test-code&state=test-state');

    expect(screen.getByRole('status', { name: 'ログイン中' })).toBeInTheDocument();
    expect(screen.getByText('ログイン中...')).toBeInTheDocument();
  });

  it('codeがない場合はログインページへリダイレクトする', async () => {
    renderWithRoute('');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login');
    });
  });

  it('errorパラメータがある場合は失敗の理由を添えてログインページへリダイレクトする', async () => {
    renderWithRoute('?error=access_denied');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { loginError: '認証エラーが発生しました' } });
    });
  });

  it('認証成功時にホームページへリダイレクトする', async () => {
    vi.mocked(authRepository.login).mockResolvedValue({ message: 'ログインしました。' });

    renderWithRoute('?code=valid-code&state=test-state');

    await waitFor(() => {
      // 認可を始めたときに置いた検証値を添えて交換する。
      expect(mockExchangeCodeForToken).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'configured' }),
        'valid-code',
        FLOW.codeVerifier,
      );
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
  });

  it('認証失敗時に失敗の理由を添えてログインページへリダイレクトする', async () => {
    vi.mocked(authRepository.login).mockRejectedValue(new Error('認証失敗'));

    renderWithRoute('?code=invalid-code&state=test-state');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/login', { state: { loginError: '認証に失敗しました' } });
    });
  });

  it('認証成功時に store の isAuthenticated が true になる', async () => {
    vi.mocked(authRepository.login).mockResolvedValue({ message: 'ログインしました。' });

    const { store } = renderWithRoute('?code=valid-code&state=test-state');

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith('/');
    });
    expect(store.getState().auth.isAuthenticated).toBe(true);
  });
});
