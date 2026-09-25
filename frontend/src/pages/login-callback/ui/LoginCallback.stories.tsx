import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withApi, withRouter, withStore } from '../../../../.storybook/decorators';
import LoginCallback from './LoginCallback';
import LoginCallbackView from './LoginCallbackView';

/**
 * ログインの発行者から戻ってきた直後に、一瞬だけ通る画面。
 *
 * ふだんは「ログイン中…」だけ。ここで受け取った合図をサーバーに渡し、済んだら次の画面へ移る。
 * 時間がかかったときだけ、理由と「ログイン画面へ戻る」を出す（回るだけの画面に置き去りにしない）。
 *
 * 一瞬しか見えない画面ほど、見本が要る（実際に踏むのが難しく、壊れても気づきにくい）。
 */
const meta = {
  title: 'pages/login-callback/LoginCallback',
  component: LoginCallback,
  parameters: { layout: 'fullscreen' },
  decorators: [withRouter, withStore({ isAuthenticated: false, loading: true }), withApi({})],
} satisfies Meta<typeof LoginCallback>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 受け渡している最中。 */
export const 処理中: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('ログイン中...')).toBeVisible();
  },
};

/** 時間がかかっている（受け渡しは続けたまま、戻る手段を出す）。 */
export const 時間がかかっている: Story = {
  render: () => <LoginCallbackView slow />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText(/ログインに時間がかかっています/)).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'ログイン画面へ戻る' })).toHaveAttribute('href', '/login');
  },
};
