import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withRouter, withToast } from '../../../../.storybook/decorators';
import ProfilePage from './ProfilePage';

/**
 * 自分の情報を見て直す画面。
 *
 * 保存の結果は知らせ（トースト）で伝える。入力欄はそのまま残すので、失敗しても
 * 打ち直しにはならない。
 */
const meta = {
  title: 'pages/settings/ProfilePage',
  component: ProfilePage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRouter,
    withToast,
    (Story) => (
      <div className="bg-surface p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProfilePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 情報が取れたとき。 */
export const 既定: Story = {
  decorators: [
    withApi({
      '/profile/me': {
        displayName: '川野 拓馬',
        email: 'takuma@example.com',
        avatarUrl: null,
        bio: 'Go と React を勉強しています。',
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByDisplayValue('川野 拓馬')).toBeVisible();
  },
};

/** 写真を登録しているとき。 */
export const 写真つき: Story = {
  decorators: [
    withApi({
      '/profile/me': {
        displayName: '川野 拓馬',
        email: 'takuma@example.com',
        avatarUrl:
          'data:image/svg+xml;utf8,' +
          encodeURIComponent(
            '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96">' +
              '<rect width="96" height="96" fill="#7c6f64"/>' +
              '<circle cx="48" cy="38" r="18" fill="#f2e5bc"/>' +
              '<circle cx="48" cy="86" r="30" fill="#f2e5bc"/>' +
              '</svg>',
          ),
        bio: '',
      },
    }),
  ],
};

/** 情報が取れなかったとき。 */
export const 取得に失敗: Story = {
  decorators: [withApi({})],
};

const profile = {
  userId: 7,
  displayName: '山田 花子',
  email: 'hanako@example.com',
  avatarUrl: null,
  bio: '',
  status: '',
};

/** 書き換えたら、保存していない変更があることを保存ボタンのそばに出す。保存したらその場に「保存しました」。 */
export const 書き換えて保存する: Story = {
  decorators: [
    withApi({
      '/profile/me/update': (config: { data?: unknown }) => ({
        ...profile,
        ...(typeof config.data === 'string' ? JSON.parse(config.data) : {}),
      }),
      '/profile/me': profile,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = await canvas.findByLabelText('ステータス');
    await userEvent.type(status, '取り込み中');
    await expect(canvas.getByText('保存していない変更があります')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'プロフィールを保存' }));
    await waitFor(async () => {
      await expect(canvas.getByText('保存しました')).toBeVisible();
    });
    await expect(canvas.queryByText('保存していない変更があります')).toBeNull();
  },
};

/** 氏名が空なら送らず、氏名の欄のそばに理由を出す。 */
export const 氏名が空: Story = {
  decorators: [withApi({ '/profile/me': profile })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const name = await canvas.findByDisplayValue('山田 花子');
    await userEvent.clear(name);
    await userEvent.click(canvas.getByRole('button', { name: 'プロフィールを保存' }));
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    await expect(name).toHaveAccessibleDescription(/氏名を入力してください/);
  },
};
