import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import type { PasswordResetPageState } from '../model/usePasswordResetPage';
import PasswordResetView from './PasswordResetView';

function state(over: Partial<PasswordResetPageState> = {}): PasswordResetPageState {
  return {
    mode: 'firebase',
    email: '',
    setEmail: fn(),
    submitted: false,
    loading: false,
    handleSubmit: fn((e) => e.preventDefault()),
    missing: [],
    ...over,
  };
}

/**
 * パスワード再設定画面（ログイン画面と同じ ST06 の形）。送った結果（アカウントがあったか）は
 * 画面に出さない。ローカル（Dex）はこの機能を持たない。
 */
const meta = {
  title: 'pages/password-reset/PasswordResetView',
  component: PasswordResetView,
  parameters: { layout: 'fullscreen' },
  args: state(),
  decorators: [
    withRouter,
    (Story) => (
      <div className="h-[760px]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PasswordResetView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 本番のフォーム: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'パスワードの再設定' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '再設定メールを送信' }));
    await expect(args.handleSubmit).toHaveBeenCalledTimes(1);
    await expect(canvas.getByRole('link', { name: 'ログインへ戻る' })).toHaveAttribute('href', '/login');
  },
};

/** 送った後。アカウントがあったかどうかに関わらず、同じ案内を出す。 */
export const 送った: Story = {
  args: state({ submitted: true }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status')).toHaveTextContent('該当するアカウントが存在する場合');
    await expect(canvas.queryByLabelText('メールアドレス')).toBeNull();
  },
};

export const ローカルの発行者: Story = {
  args: state({ mode: 'dex' }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('対応していません');
  },
};

export const 設定が欠けている: Story = {
  args: state({ mode: 'unconfigured', missing: ['VITE_FIREBASE_API_KEY'] }),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('現在ログインを受け付けていません');
  },
};
