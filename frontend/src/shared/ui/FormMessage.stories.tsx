import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import FormMessage from './FormMessage';

/**
 * フォーム全体の結果を伝える帯（保存できた / 保存できなかった）。
 *
 * 欄ごとのエラー（FormFieldError）とは役割が違う。こちらは**送信のあと**に出す。
 * `onDismiss` を渡すと ✕ が出る。成功は 5 秒で自動的に消えるが、**失敗は自動では消えない**
 * （読み逃すと何を直せばよいか分からなくなるので、✕ を押すまで残す）。
 * 失敗は `role="alert"`（割り込んで読む）、成功は `role="status"`（手が空いたときに読む）。
 */
const meta = {
  title: 'shared/FormMessage',
  component: FormMessage,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FormMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 成功。緑。 */
export const 成功: Story = {
  args: { message: { type: 'success', text: 'プロフィールを保存しました' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('プロフィールを保存しました');
  },
};

/** 失敗。赤。 */
export const 失敗: Story = {
  args: { message: { type: 'error', text: '保存できませんでした。通信を確認してください' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('保存できませんでした');
  },
};

/** 閉じられる失敗。✕ は出るが、自動では消えない。 */
export const 閉じられる失敗: Story = {
  args: {
    message: { type: 'error', text: '保存できませんでした。通信を確認してください' },
    onDismiss: fn(),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '閉じる' })).toBeVisible();
  },
};

/** 閉じられる形。✕ を押すと onDismiss が呼ばれる。 */
export const 閉じられる: Story = {
  args: {
    message: { type: 'success', text: 'プロフィールを保存しました' },
    onDismiss: fn(),
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '閉じる' }));
    await expect(args.onDismiss).toHaveBeenCalled();
  },
};

/** 知らせが無いとき。何も描かない。 */
export const 何も出ない: Story = {
  args: { message: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('alert')).toBeNull();
    await expect(within(canvasElement).queryByRole('status')).toBeNull();
  },
};
