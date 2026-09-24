import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import Toast from './Toast';

/**
 * 画面の上から落ちてくる短い知らせ。
 *
 * 成功とお知らせは 4 秒で自分から消える（マウスを乗せている間・閉じるボタンにフォーカスが
 * ある間は止まる）。**失敗は自動では消えない** — 読み逃すと何が起きたか分からなくなるので、
 * 閉じるまで残す。見逃すと進めなくなる情報は、トーストではなくその場（フォームの中）に出す。
 *
 * 置き場所（画面上部の中央）と成功・お知らせの読み上げは ToastContainer 側の仕事。失敗だけは
 * この部品自身が `role="alert"` で読まれる。
 */
const meta = {
  title: 'shared/Toast',
  component: Toast,
  parameters: { layout: 'centered' },
  args: { onClose: fn() },
} satisfies Meta<typeof Toast>;

export default meta;
type Story = StoryObj<typeof meta>;

/** うまくいったとき。 */
export const 成功: Story = {
  args: { type: 'success', message: 'ページを保存しました' },
  play: async ({ canvasElement }) => {
    // 知らせは 0.6 秒かけて上から落ちてくる（出始めは透明）。落ちきるのを待ってから見る。
    await waitFor(async () => {
      await expect(within(canvasElement).getByText('ページを保存しました')).toBeVisible();
    });
    // 成功は割り込んで読ませない（ToastContainer の polite の領域が読む）。
    await expect(within(canvasElement).queryByRole('alert')).toBeNull();
  },
};

/** 失敗したとき。 */
export const 失敗: Story = {
  args: { type: 'error', message: '保存できませんでした。通信を確認してください' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('保存できませんでした');
  },
};

/** ただのお知らせ。 */
export const お知らせ: Story = {
  args: { type: 'info', message: '共有リンクをコピーしました' },
};

/** 3 種類を並べて比べる。 */
export const 種類ぜんぶ: Story = {
  args: { type: 'success', message: '' },
  render: (args) => (
    <div className="flex flex-col gap-3">
      <Toast {...args} type="success" message="ページを保存しました" />
      <Toast {...args} type="error" message="保存できませんでした" />
      <Toast {...args} type="info" message="共有リンクをコピーしました" />
    </div>
  ),
};

/** 長い文でも折り返して収まる。 */
export const 長い文: Story = {
  args: {
    type: 'error',
    message:
      '保存できませんでした。ネットワークに接続していないか、ほかの人が同じページを編集しています。しばらく待ってからもう一度お試しください。',
  },
};

/** ✕ を押すと閉じる。 */
export const 閉じたとき: Story = {
  args: { type: 'info', message: '共有リンクをコピーしました' },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '閉じる' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
