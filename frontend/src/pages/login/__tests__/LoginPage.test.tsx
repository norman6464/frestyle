import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { MemoryRouter } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import LoginPage from '../ui/LoginPage';
import authReducer from '@/entities/user/model/authSlice';

vi.mock('firebase/auth', async () => {
  const actual = await vi.importActual<typeof import('firebase/auth')>('firebase/auth');
  return {
    ...actual,
    signInWithEmailAndPassword: vi.fn(),
    signInWithPopup: vi.fn(),
  };
});

vi.mock('@/shared/lib/auth/firebaseApp', () => ({
  getFirebaseAuth: vi.fn(() => ({ /* フェイクの Auth インスタンス */ })),
}));

function renderLoginPage() {
  const store = configureStore({
    reducer: { auth: authReducer },
    preloadedState: { auth: { isAuthenticated: false, loading: false } },
  });
  return render(
    <Provider store={store}>
      <MemoryRouter>
        <LoginPage />
      </MemoryRouter>
    </Provider>,
  );
}

// テストの既定値は Dex 設定が揃っている（src/test/setup.ts）。GCIP（Firebase）は
// 個々のテストで stubEnv して有効にする。
const FIREBASE_ENVS = {
  VITE_FIREBASE_API_KEY: 'test-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'test-project',
} as const;

function stubFirebaseEnv() {
  Object.entries(FIREBASE_ENVS).forEach(([key, value]) => vi.stubEnv(key, value));
}

describe('LoginPage（Dex モード・既定）', () => {
  it('発行者のログイン画面へ送るボタンだけを置く', () => {
    renderLoginPage();

    expect(screen.getByRole('heading', { name: 'ログイン' })).toBeInTheDocument();
    // 「在ること」だけでなく「押せること」まで見る。設定が揃っているのに
    // 押せない状態も、押せるのに何も起きない状態も、ここで落ちる。
    expect(screen.getByRole('button', { name: 'ログイン画面へ進む' })).toBeEnabled();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  // パスワードを受け取るのは発行者のログイン画面の役目。アプリが受け取ると、
  // 二要素・ロックアウト・パスワードの強さといった発行者側の守りを素通りする
  // 経路を自分で開くことになる。
  it('メールとパスワードの入力欄を置かない', () => {
    renderLoginPage();

    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('パスワード')).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'ログインフォーム' })).not.toBeInTheDocument();
  });

  it('Google ログイン導線がある', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
  });

  it('アカウント作成への導線がフォームの下にあり、ロゴは 1 つだけ', () => {
    renderLoginPage();
    expect(screen.getByRole('link', { name: '新規登録' })).toHaveAttribute('href', '/signup');
    // 上部の帯は置かない。ロゴ（ホームへのリンク）は広い画面の左の面か、狭い画面のフォームの上の
    // どちらか 1 つだけが見える（もう片方は CSS で隠す）。jsdom は CSS を当てないので両方が DOM にある。
    for (const logo of screen.getAllByRole('link', { name: 'FreStyle ホーム' })) {
      expect(logo).toHaveAttribute('href', '/');
    }
  });
});

/*
 * 本番（GCIP）の姿。メールとパスワードをその場で受け取る——ここでは発行者の SDK が
 * 直接検証するので、Dex 向けの「アプリが受け取ってはいけない」制約が当てはまらない。
 */
describe('LoginPage（Firebase モード）', () => {
  beforeEach(() => {
    stubFirebaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('メールとパスワードの入力欄・パスワード再設定への導線を置く', () => {
    renderLoginPage();

    expect(screen.getByRole('form', { name: 'ログインフォーム' })).toBeInTheDocument();
    expect(screen.getByLabelText('メールアドレス')).toBeInTheDocument();
    expect(screen.getByLabelText('パスワード')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /パスワードをお忘れ/ })).toHaveAttribute('href', '/password-reset');
  });

  it('Dex 向けの「発行者へ送る」ボタンは出さない', () => {
    renderLoginPage();
    expect(screen.queryByText('ログイン画面へ移動しています...')).not.toBeInTheDocument();
  });

  it('Google ログイン導線がある', () => {
    renderLoginPage();
    expect(screen.getByRole('button', { name: /Google/ })).toBeInTheDocument();
  });
});

/*
 * 設定が両方とも欠けているときの姿。
 *
 * ボタンを消さず、押せない状態のまま理由を添える。消してしまうと外から見て
 * 「壊れているのか、意図的に止めているのか」が区別できない。
 */
describe('LoginPage（認可の設定が欠けているとき）', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_OIDC_AUTHORIZE_URI', '');
    vi.stubEnv('VITE_OIDC_TOKEN_URI', '');
    vi.stubEnv('VITE_OIDC_CLIENT_ID', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('フォームもボタンも出さず、押せない理由を画面に出す', () => {
    renderLoginPage();
    expect(screen.queryByLabelText('メールアドレス')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'ログイン' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).not.toBeInTheDocument();

    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('現在ログインを受け付けていません');
  });

  // 欠けている設定の名前は人が読む文には出さない(利用者に意味が無い)。
  // 運用する側が要素を見れば分かるよう、属性には載せる。
  it('欠けている設定の名前は文ではなく属性に載せる', () => {
    renderLoginPage();
    const notice = screen.getByRole('status');
    expect(notice.textContent).not.toContain('VITE_');
    expect(notice.getAttribute('data-missing')).toContain('VITE_OIDC_AUTHORIZE_URI');
    expect(notice.getAttribute('data-missing')).toContain('VITE_OIDC_CLIENT_ID');
  });
});

describe('LoginPage（Firebase メールログインの送信）', () => {
  beforeEach(() => {
    stubFirebaseEnv();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('メールとパスワードを入力して送信すると signInWithEmailAndPassword が呼ばれる', () => {
    vi.mocked(signInWithEmailAndPassword).mockImplementation(
      () => new Promise(() => {}), // pending のまま。ここでは呼び出し内容だけ見る。
    );

    renderLoginPage();

    fireEvent.change(screen.getByLabelText('メールアドレス'), { target: { value: 'user@example.com' } });
    fireEvent.change(screen.getByLabelText('パスワード'), { target: { value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: 'ログイン' }));

    expect(signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'user@example.com', 'password123');
  });
});
