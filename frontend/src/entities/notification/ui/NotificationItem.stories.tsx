import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import NotificationItem from './NotificationItem';
import type { Notification } from '../model/types';

/**
 * 知らせ 1 件ぶんの札。
 *
 * まだ読んでいないものは地色が濃く、丸い印が付き、右に「既読にする」が出る。読み終わると
 * それらが消える — 読んだかどうかを、色だけでなく**要素の有無**でも区別できるようにしてある。
 *
 * # バッジに英字が出ているのは、いまはそれが正しい姿
 *
 * 種別に日本語の名前を当てる対応表は**空にしてある**。backend の通知は種別が自由文字列で、
 * いま通知を作る処理が 1 つも無い（一覧と既読の口だけがある）。実在しない種別を先回りで
 * 並べる事故を 2 度起こしているので、作られるようになってから、確かめた種別だけを足す。
 *
 * そのため、いまはどの知らせが来ても種別の文字がそのまま出る。ここの見本もその姿で置いてある。
 */
const meta = {
  title: 'entities/notification/NotificationItem',
  component: NotificationItem,
  parameters: { layout: 'padded' },
  args: { onMarkAsRead: fn() },
  decorators: [
    withRouter,
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NotificationItem>;

export default meta;
type Story = StoryObj<typeof meta>;

// 種別は実在の値ではなく、素性の分かる仮の値。実在する種別が無いので当てようがない。
const notification = (over: Partial<Notification> = {}): Notification => ({
  id: 1,
  type: 'sample_type',
  title: 'コメントに返信がありました',
  body: '「設計メモ」のコメントに返信が付きました。',
  isRead: false,
  linkPath: '',
  createdAt: '2026-09-06T09:41:00Z',
  ...over,
});

/** まだ読んでいないとき。 */
export const 未読: Story = {
  args: { notification: notification() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('コメントに返信がありました')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '既読にする' })).toBeVisible();
  },
};

/** 読んだあと。印も「既読にする」も消える。 */
export const 既読: Story = {
  args: { notification: notification({ isRead: true }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: '既読にする' })).toBeNull();
  },
};

/**
 * 種別の文字がそのまま出るところ。
 *
 * 対応表が空なので、いまはどの種別でもこうなる。空欄にしないのが要点で、
 * 「何の知らせなのか」の手がかりを消さないための落としどころ。
 */
export const 種別がそのまま出る: Story = {
  args: {
    notification: notification({
      type: 'another_sample_type',
      title: 'ページが共有されました',
      body: '「設計メモ」が閲覧できるようになりました。',
    }),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('another_sample_type')).toBeVisible();
  },
};

/** 本文が長いとき。折り返して収まる。 */
export const 長い本文: Story = {
  args: {
    notification: notification({
      body: '「設計メモ」に長いコメントが付きました。プロジェクトの背景から、決まった仕様、まだ決まっていない点まで、一通りの経緯がまとめて書かれています。',
    }),
  },
};

/** 本文が空でも、題名だけは出る。 */
export const 本文が空: Story = {
  args: { notification: notification({ body: '' }) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('コメントに返信がありました')).toBeVisible();
  },
};

/** 「既読にする」を押すと、その id が親へ渡る。 */
export const 既読にする: Story = {
  args: { notification: notification({ id: 7 }) },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '既読にする' }));
    await expect(args.onMarkAsRead).toHaveBeenCalledWith(7);
  },
};

/**
 * 飛び先があるとき。題名が目的地（チケット）へのリンクになり、押すと既読にしてから遷移する。
 * 行全体ではなく題名だけをリンクにするのは、中に「既読にする」ボタンがあって操作が入れ子に
 * なるため。矢印は「ここから出て行く」の印。
 */
export const 飛び先あり: Story = {
  args: { notification: notification({ id: 3, linkPath: '/tickets/t-1' }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole('link', { name: 'コメントに返信がありました' });
    await expect(link).toHaveAttribute('href', '/tickets/t-1');
    await userEvent.click(link);
    await expect(args.onMarkAsRead).toHaveBeenCalledWith(3);
  },
};

/** 既読で飛び先があるとき。リンクは残り、「既読にする」だけが消える。押しても既読化は呼ばない。 */
export const 既読で飛び先あり: Story = {
  args: { notification: notification({ isRead: true, linkPath: '/tickets/t-1' }) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '既読にする' })).toBeNull();
    await userEvent.click(canvas.getByRole('link', { name: 'コメントに返信がありました' }));
    await expect(args.onMarkAsRead).not.toHaveBeenCalled();
  },
};

/**
 * 飛び先が外部 URL（スキーム相対）のとき。backend の CHECK が弾くので本来は来ないが、
 * 画面側でも同じ規則で確かめ、リンクにせず文字だけを出す。
 */
export const 飛び先が外部URLなら文字だけ: Story = {
  args: { notification: notification({ linkPath: '//evil.example' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('link')).toBeNull();
    await expect(canvas.getByText('コメントに返信がありました')).toBeVisible();
  },
};

/** 一覧での見え方（未読と既読が混ざったところ）。 */
export const 並べたところ: Story = {
  args: { notification: notification() },
  render: (args) => (
    <div className="space-y-2">
      <NotificationItem {...args} notification={notification({ id: 1 })} />
      <NotificationItem
        {...args}
        notification={notification({
          id: 2,
          title: 'ページが共有されました',
          body: '「設計メモ」が閲覧できるようになりました。',
          isRead: true,
        })}
      />
    </div>
  ),
};
