import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { FirebaseAuthActions, OidcLogin } from '@/features/auth';
import { withRouter } from '../../../../.storybook/decorators';
import type { LoginPageState } from '../model/useLoginPage';
import LoginView from './LoginView';

const firebase = (over: Partial<Extract<FirebaseAuthActions, { available: true }>> = {}): FirebaseAuthActions => ({
  available: true,
  loading: false,
  errorMessage: null,
  errorField: null,
  signInWithEmail: fn(async () => true),
  signUpWithEmail: fn(async () => true),
  signInWithGoogle: fn(async () => true),
  sendPasswordReset: fn(async () => true),
  ...over,
});
const dex = (over: Partial<Extract<OidcLogin, { available: true }>> = {}): OidcLogin => ({
  available: true,
  loading: false,
  errorMessage: null,
  start: fn(),
  ...over,
});
const firebaseMissing: FirebaseAuthActions = { available: false, missing: ['VITE_FIREBASE_API_KEY'] };
const dexMissing: OidcLogin = { available: false, missing: ['VITE_OIDC_CLIENT_ID'] };

function state(over: Partial<LoginPageState> = {}): LoginPageState {
  return {
    loginError: null,
    mode: 'firebase',
    email: '',
    password: '',
    setEmail: fn(),
    setPassword: fn(),
    firebaseAuth: firebase(),
    handleEmailSignIn: fn((e) => e.preventDefault()),
    handleGoogleSignIn: fn(),
    dexLogin: dexMissing,
    sessionError: null,
    ...over,
  };
}

/** 入力できる形（メールとパスワードを手元の state で持つ）。 */
function Interactive(props: LoginPageState) {
  const [email, setEmail] = useState(props.email);
  const [password, setPassword] = useState(props.password);
  return <LoginView {...props} email={email} password={password} setEmail={setEmail} setPassword={setPassword} />;
}

/**
 * ログイン画面（設計ボード ST06）。左にブランドの面、右にフォーム。見た目の部品に状態を
 * 渡して描くので、手元の設定（.env）に左右されず、本番（GCIP）の形・失敗・送信中・設定の欠け・
 * ローカル（Dex）の形を並べて見られる。
 */
const meta = {
  title: 'pages/login/LoginView',
  component: LoginView,
  parameters: { layout: 'fullscreen' },
  args: state(),
  decorators: [
    withRouter,
    (Story) => (
      <div className="h-[860px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof LoginView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 本番（GCIP）。メールとパスワードをこの場で受け取る。ロゴは 1 つだけ。 */
export const 本番のフォーム: Story = {
  render: (args) => <Interactive {...args} />,
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'ログイン' })).toBeVisible();
    await expect(canvas.getByText('おかえりなさい。続きをはじめましょう。')).toBeVisible();
    await userEvent.type(canvas.getByLabelText('メールアドレス'), 'you@example.com');
    await userEvent.type(canvas.getByLabelText('パスワード'), 'secret-pass');
    await expect(canvas.getByRole('link', { name: 'パスワードをお忘れですか？' })).toHaveAttribute('href', '/password-reset');
    await userEvent.click(canvas.getByRole('button', { name: 'ログイン' }));
    await expect(args.handleEmailSignIn).toHaveBeenCalledTimes(1);
    await expect(canvas.getByRole('button', { name: 'Google でログイン' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: '新規登録' })).toHaveAttribute('href', '/signup');
    const logos = canvas.getAllByRole('link', { name: 'FreStyle ホーム' });
    await expect(logos.filter((l) => l.checkVisibility())).toHaveLength(1);
  },
};

/** メールかパスワードのどちらかが違う。どちらかは言わず（登録の有無を漏らさない）、フォームの上に出す。 */
export const 本番で入力が違う: Story = {
  args: state({
    firebaseAuth: firebase({ errorMessage: 'メールアドレスまたはパスワードが正しくありません。' }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('メールアドレスまたはパスワードが正しくありません。');
    await expect(canvas.getByLabelText('メールアドレス')).not.toHaveAttribute('aria-invalid', 'true');
  },
};

/** 欄の直しで解ける失敗は、その欄のそばに出す（フォームの上には重ねない）。 */
export const 本番でメールの形式が違う: Story = {
  args: state({
    email: 'you@',
    firebaseAuth: firebase({ errorMessage: 'メールアドレスの形式が正しくありません。', errorField: 'email' }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const email = canvas.getByLabelText('メールアドレス');
    await expect(email).toHaveAttribute('aria-invalid', 'true');
    await expect(email).toHaveAccessibleDescription(/メールアドレスの形式が正しくありません/);
    await expect(canvas.getAllByText('メールアドレスの形式が正しくありません。')).toHaveLength(1);
  },
};

/** 送っている間は押せない。 */
export const 送信中: Story = {
  args: state({ email: 'you@example.com', password: 'secret-pass', firebaseAuth: firebase({ loading: true }) }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'ログイン' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Google でログイン' })).toBeDisabled();
  },
};

/** ログインの戻り処理が失敗して戻ってきた。成功の見た目にせず、失敗として出す。 */
export const 戻り処理の失敗: Story = {
  args: state({ mode: 'dex', firebaseAuth: firebaseMissing, dexLogin: dex(), loginError: 'ログインの検証に失敗しました。もう一度お試しください。' }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('ログインの検証に失敗しました');
  },
};

/** ローカル（Dex）。発行者のログイン画面へ送るだけで、パスワードは受け取らない。 */
export const ローカルの発行者: Story = {
  args: state({ mode: 'dex', firebaseAuth: firebaseMissing, dexLogin: dex() }),
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText('メールアドレス')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'ログイン画面へ進む' }));
    const d = args.dexLogin as Extract<OidcLogin, { available: true }>;
    await expect(d.start).toHaveBeenCalledTimes(1);
  },
};

/** 認証の設定が欠けている。ボタンを消さず、理由を出す。 */
export const 設定が欠けている: Story = {
  args: state({ mode: 'unconfigured', firebaseAuth: firebaseMissing, dexLogin: dexMissing }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('現在ログインを受け付けていません');
    await expect(canvas.queryByRole('button', { name: 'ログイン' })).toBeNull();
  },
};

export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
