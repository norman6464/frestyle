import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import ErrorNotice from './ErrorNotice';

/**
 * 取得の失敗と、次の操作（取り直し）。
 *
 * 0 件と見分けがつくように何が読めなかったかを書き、取り直せるなら必ずボタンを置く。
 * 本文の中は panel、サイドバー・右のパネル・ポップオーバーの中は inline。
 */
const meta = {
  title: 'shared/ErrorNotice',
  component: ErrorNotice,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-xl">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 本文の中の区画。取り直しを押すと呼ばれる。 */
export const 区画: Story = {
  args: { message: '担当チケットを読み込めませんでした。', onRetry: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('担当チケットを読み込めませんでした。');
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(args.onRetry).toHaveBeenCalledOnce();
  },
};

/** 補足を添える。補足は知らせの読み上げに含めない。 */
export const 補足つき: Story = {
  args: {
    message: '通知を読み込めませんでした。',
    description: '通知が無いのではなく、読み込めていない状態です。',
    onRetry: fn(),
  },
};

/** サイドバーや右のパネルの中。 */
export const 狭い場所: Story = {
  args: { message: 'スペースを読み込めませんでした', onRetry: fn(), variant: 'inline' },
  decorators: [
    (Story) => (
      <div className="w-60 rounded-lg border border-surface-3 bg-surface-1 p-2">
        <Story />
      </div>
    ),
  ],
};

/** 画面を塞がない知らせ。一覧は使えるまま、一部だけ読めない。 */
export const 塞がない知らせ: Story = {
  args: { message: 'スプリントを読み込めませんでした。', onRetry: fn(), politeness: 'polite' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('alert')).toBeNull();
    await expect(canvas.getByRole('status')).toHaveTextContent('スプリントを読み込めませんでした。');
  },
};

/** 長い文言でも枠からはみ出さない（幅 375 相当）。 */
export const 狭い幅で長い文言: Story = {
  args: {
    message: 'このページを参照しているチケットを取得できませんでした。時間をおいてもう一度お試しください。',
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[343px]">
        <Story />
      </div>
    ),
  ],
};
