import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withRouter, withToast } from '../../../../.storybook/decorators';
import NotificationPage from './NotificationPage';

/**
 * 届いた知らせの一覧。
 *
 * 未読は地色が濃く、丸い印が付く。読んだかどうかを、色だけでなく要素の有無でも
 * 区別できるようにしてある。
 */
const meta = {
  title: 'pages/notifications/NotificationPage',
  component: NotificationPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRouter,
    withToast,
    (Story) => (
      <div className="min-h-screen bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// 通知 entity で対応しているコメント通知を使う。
const notification = (id: number, title: string, body: string, isRead: boolean) => ({
  id,
  type: 'ticket_commented',
  title,
  body,
  isRead,
  linkPath: '',
  createdAt: '2026-09-06T09:41:00Z',
});

/** 未読と既読が混ざっているとき。 */
export const 既定: Story = {
  decorators: [
    withApi({
      // 件数の宛先は一覧の宛先を含むので、細かいほうを先に書く。
      '/notifications/unread-count': 2,
      '/notifications': [
        notification(
          1,
          'コメントに返信がありました',
          '「設計メモ」のコメントに返信が付きました。',
          false,
        ),
        notification(2, 'チケットにコメントが届きました', '「画面遷移の確認」に確認事項が追加されました。', false),
        notification(3, 'コメントに返信がありました', '「議事録」のコメントに返信が付きました。', true),
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('チケットにコメントが届きました')).toBeVisible();
    });
    await userEvent.click(canvas.getByRole('button', { name: '未読' }));
    await expect(canvas.queryByText('「議事録」のコメントに返信が付きました。')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'すべて' }));
    await expect(canvas.getByText('「議事録」のコメントに返信が付きました。')).toBeVisible();
  },
};

/** 1 件も無いとき。 */
export const 空: Story = {
  decorators: [withApi({ '/notifications/unread-count': 0, '/notifications': [] })],
};

/** 取れなかったとき。 */
export const 取得に失敗: Story = {
  decorators: [withApi({})],
};

export const 狭い画面: Story = {
  ...既定,
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

export const 未読なし: Story = {
  decorators: [withApi({ '/notifications/unread-count': 0, '/notifications': [notification(1, '確認済みのお知らせ', '通知はあとから見返せます。', true)] })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('確認済みのお知らせ');
    await userEvent.click(canvas.getByRole('button', { name: '未読' }));
    await expect(canvas.getByText('未読の通知はありません')).toBeVisible();
  },
};
