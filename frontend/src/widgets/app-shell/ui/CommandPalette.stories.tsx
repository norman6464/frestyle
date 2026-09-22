import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import CommandPalette from './CommandPalette';

/**
 * どこからでも開ける「行き先を探す窓」。
 *
 * 打つと候補が絞られ、上下キーで選び、Enter で移る。マウスを使わずに画面を移れるので、
 * ナビの位置を覚えていなくても目的地に着ける。
 *
 * 日本語のラベルだけでなく英語の別名（`kb` `wiki` など）でも引ける。ローマ字入力のまま
 * 打ち始める人が、いちいち変換しなくてよいようにしてある。
 *
 * 見つからないときは「該当するコマンドがありません」と出す。空欄にすると、
 * 壊れているのか一致が無いのか分からない。
 */
const meta = {
  title: 'widgets/app-shell/CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  args: { isOpen: true, onClose: fn() },
  decorators: [
    withRouter,
    (Story) => (
      <div className="min-h-[560px] bg-surface p-6">
        <p className="text-sm text-[var(--color-text-secondary)]">
          この後ろに画面があり、その上に窓が重なる。
        </p>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 開いた直後。全部の行き先が出る。 */
export const 開いたところ: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByPlaceholderText('移動先を探す...')).toBeVisible();
    await expect(canvas.getByText('ナレッジ')).toBeVisible();
  },
};

/** 閉じているとき。何も描かない。 */
export const 閉じている: Story = {
  args: { isOpen: false },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByPlaceholderText('移動先を探す...')).toBeNull();
  },
};

/** 打って絞り込んだところ。 */
export const 絞り込む: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText('移動先を探す...'), 'ナレッジ');
    await expect(canvas.getByText('ナレッジ')).toBeVisible();
    await expect(canvas.queryByText('ホーム')).toBeNull();
  },
};

/** 英語の別名でも引ける。 */
export const 英語でも引ける: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText('移動先を探す...'), 'wiki');
    await expect(canvas.getByText('ナレッジ')).toBeVisible();
  },
};

/** どれにも当たらないとき。 */
export const 該当なし: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByPlaceholderText('移動先を探す...'), 'zzzzzzz');
    await expect(canvas.getByText('該当するコマンドがありません')).toBeVisible();
  },
};

/** 上下キーで選ぶ。 */
export const キーボードで選ぶ: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByPlaceholderText('移動先を探す...');
    await userEvent.type(input, '{ArrowDown}');
    const options = canvas.getAllByRole('option');
    await expect(options[1]).toHaveAttribute('aria-selected', 'true');
  },
};

/** Escape で閉じる。 */
export const Escapeで閉じる: Story = {
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByPlaceholderText('移動先を探す...');
    await userEvent.type(input, '{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};
