import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import HeaderUserMenu from './HeaderUserMenu';

/**
 * ヘッダー右端の、自分の名前を押すと下に開くメニュー。
 *
 * 中身は「設定」と「ログアウト」だけ。ここに項目を足しはじめると、ヘッダーが
 * 何でも入る引き出しになり、目的の物を探す場所として使えなくなる。
 *
 * 外を押すと閉じる。開いたものを閉じる手立てが無いのは、どの入力手段でも困る。
 */
const meta = {
  title: 'widgets/app-shell/HeaderUserMenu',
  component: HeaderUserMenu,
  parameters: { layout: 'padded' },
  args: { onLogout: fn(), displayName: '川野 拓馬' },
  decorators: [
    withRouter,
    (Story) => (
      // 実物はヘッダーの右端。開いたメニューが入る高さを確保する。
      <div className="flex h-64 justify-end bg-surface-1 p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HeaderUserMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 閉じているとき。 */
export const 閉じている: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /川野 拓馬/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  },
};

export const Escapeで閉じてフォーカスを戻す: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: '川野 拓馬 のアカウント' });
    if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger);
    (await portal.findByRole('menuitem', { name: '設定' })).focus();
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(trigger).toHaveAttribute('aria-expanded', 'false');
      await expect(trigger).toHaveFocus();
    });
  },
};

/** 開いたところ。メールアドレスと 2 つの項目が出る。 */
export const 開いたところ: Story = {
  args: { email: 'takuma@example.com' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: /川野 拓馬/ }));
    // メニューは 0.15 秒かけて現れる。出きる前に見ると opacity が 0 のままなので待つ。
    await waitFor(async () => {
      await expect(portal.getByText('takuma@example.com')).toBeVisible();
    });
    await expect(portal.getByRole('menuitem', { name: '設定' })).toBeVisible();
    await expect(portal.getByRole('menuitem', { name: 'ログアウト' })).toBeVisible();
  },
};

/** 写真があるとき。 */
export const 写真つき: Story = {
  args: {
    email: 'takuma@example.com',
    avatarUrl:
      'data:image/svg+xml;utf8,' +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">' +
          '<rect width="64" height="64" fill="#7c6f64"/>' +
          '<circle cx="32" cy="26" r="12" fill="#f2e5bc"/>' +
          '<circle cx="32" cy="58" r="20" fill="#f2e5bc"/>' +
          '</svg>',
      ),
  },
};

/** 補足の行を添えるとき（所属など）。 */
export const 補足つき: Story = {
  args: { email: 'takuma@example.com', subText: '開発チーム' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole('button', { name: /川野 拓馬/ }));
    await waitFor(async () => {
      await expect(portal.getByText('開発チーム')).toBeVisible();
    });
  },
};

/** 名前が長いとき。切り詰めてヘッダーを押し広げない。 */
export const 長い名前: Story = {
  args: { displayName: '非常に長い表示名がここに入るユーザー', email: 'takuma@example.com' },
};

/** 名前が空のとき。「ユーザー」と出す（空欄にしない）。 */
export const 名前が空: Story = {
  args: { displayName: '' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('ユーザー')).toBeVisible();
  },
};

/** ログアウトを押したとき。 */
export const ログアウト: Story = {
  args: { email: 'takuma@example.com' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const portal = within(canvasElement.ownerDocument.body);
    const trigger = canvas.getByRole('button', { name: /川野 拓馬/ });
    if (trigger.getAttribute('aria-expanded') !== 'true') await userEvent.click(trigger);
    await userEvent.click(await portal.findByRole('menuitem', { name: 'ログアウト' }));
    await expect(args.onLogout).toHaveBeenCalledTimes(1);
    // 押したら閉じる。
    await waitFor(async () => {
      await expect(portal.queryByRole('menuitem', { name: '設定' })).toBeNull();
    });
  },
};
