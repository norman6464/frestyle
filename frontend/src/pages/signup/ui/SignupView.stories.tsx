import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { FirebaseAuthActions, OidcLogin } from '@/features/auth';
import { withRouter } from '../../../../.storybook/decorators';
import type { SignupPageState } from '../model/useSignupPage';
import SignupView from './SignupView';

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
const dex: OidcLogin = { available: true, loading: false, errorMessage: null, start: fn() };
const firebaseMissing: FirebaseAuthActions = { available: false, missing: ['VITE_FIREBASE_API_KEY'] };
const dexMissing: OidcLogin = { available: false, missing: ['VITE_OIDC_CLIENT_ID'] };

function state(over: Partial<SignupPageState> = {}): SignupPageState {
  return {
    mode: 'firebase',
    email: '',
    password: '',
    setEmail: fn(),
    setPassword: fn(),
    firebaseAuth: firebase(),
    handleEmailSignUp: fn((e) => e.preventDefault()),
    handleGoogleSignUp: fn(),
    dexLogin: dexMissing,
    sessionError: null,
    ...over,
  };
}

/**
 * アカウント作成画面（ログイン画面と同じ ST06 の形）。状態を渡して描くので、本番（GCIP）の
 * フォーム・欄の失敗・ローカル（Dex）・設定の欠けを並べて見られる。
 */
const meta = {
  title: 'pages/signup/SignupView',
  component: SignupView,
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
} satisfies Meta<typeof SignupView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 本番。パスワードの要件は初めから欄の下に出す。Google のボタンは「登録」の文言。 */
export const 本番のフォーム: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'アカウントを作成' })).toBeVisible();
    await expect(canvas.getByText(/メールアドレスとパスワードで、すぐに使い始められます/)).toBeVisible();
    await expect(canvas.getByLabelText('パスワード')).toHaveAccessibleDescription(/6 文字以上/);
    await userEvent.click(canvas.getByRole('button', { name: 'アカウントを作成' }));
    await expect(args.handleEmailSignUp).toHaveBeenCalledTimes(1);
    await expect(canvas.getByRole('button', { name: 'Google で登録' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'ログイン' })).toHaveAttribute('href', '/login');
  },
};

/** パスワードが短い。欄のそばに出す（フォームの上には重ねない）。 */
export const パスワードが短い: Story = {
  args: state({
    password: 'abc',
    firebaseAuth: firebase({ errorMessage: 'パスワードは 6 文字以上にしてください。', errorField: 'password' }),
  }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('パスワード')).toHaveAttribute('aria-invalid', 'true');
    await expect(canvas.queryByRole('alert', { name: /フォーム/ })).toBeNull();
    await expect(canvas.getAllByText('パスワードは 6 文字以上にしてください。')).toHaveLength(1);
  },
};

/** すでに使われているメールアドレス。メールの欄のそばに出す。 */
export const メールアドレスが使用済み: Story = {
  args: state({
    email: 'taro@example.com',
    firebaseAuth: firebase({ errorMessage: 'このメールアドレスは既に登録されています。', errorField: 'email' }),
  }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('メールアドレス')).toHaveAttribute('aria-invalid', 'true');
  },
};

/** ローカル（Dex）。自己登録の手段が無いので、発行者の画面へ送る入口だけ。 */
export const ローカルの発行者: Story = {
  args: state({ mode: 'dex', firebaseAuth: firebaseMissing, dexLogin: dex }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'メールで始める' })).toBeVisible();
    await expect(canvas.queryByLabelText('パスワード')).toBeNull();
  },
};

export const 設定が欠けている: Story = {
  args: state({ mode: 'unconfigured', firebaseAuth: firebaseMissing, dexLogin: dexMissing }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('現在ログインを受け付けていません');
  },
};

export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
