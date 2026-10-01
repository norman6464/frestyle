import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SlashMenuList from './SlashMenuList';
import { getEditorCommands } from './editorCommands';
import './richTextEditor.css';

/**
 * 本文で「/」を打ったときに出る、差し込むものの一覧。
 *
 * 出す場所を決めるのは呼び出し側で、この部品は**並べることだけ**を持つ。
 * 矢印キーで選び、Enter で決める。マウスを乗せた行も選択に変わる。
 *
 * 押しても本文からフォーカスが外れないようにしてある（外れるとメニューが先に閉じてしまう）。
 * そのため読み上げソフトには「いまどれを選んでいるか」を別の道（`aria-activedescendant`）で伝えており、
 * この部品はその id を親へ知らせる役目も持つ。
 */
const meta = {
  title: 'pages/kb/editor/SlashMenuList',
  component: SlashMenuList,
  parameters: { layout: 'centered' },
  args: { onSelect: fn(), listboxId: 'rte-slash' },
  decorators: [
    (Story) => (
      // 実物と同じく、浮いた小さな面の中に出る。
      <div className="rte-slash-menu w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SlashMenuList>;

export default meta;
type Story = StoryObj<typeof meta>;

const INSERT_COMMANDS = getEditorCommands('insert', 'turn');

/** 「/」を打った直後。差し込めるものが全部出る。 */
export const 一覧: Story = {
  args: { items: INSERT_COMMANDS },
  play: async ({ canvasElement }) => {
    const options = within(canvasElement).getAllByRole('option');
    // 先頭が選ばれた状態で始まる。
    await expect(options[0]).toHaveAttribute('aria-selected', 'true');
  },
};

/** 打ち込んで絞り込んだところ。 */
export const 絞り込んだところ: Story = {
  args: { items: INSERT_COMMANDS.slice(0, 3) },
};

/** どれにも当たらないとき。行き止まりにせず、その旨を出す。 */
export const 該当なし: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('該当するコマンドがありません')).toBeVisible();
  },
};

/** 押すと、その項目が親へ渡る。 */
export const 選んだとき: Story = {
  args: { items: INSERT_COMMANDS },
  play: async ({ args, canvasElement }) => {
    const first = INSERT_COMMANDS[0];
    // 押すのは行（option）そのもの。中にボタンは置いていない。
    await userEvent.click(within(canvasElement).getByRole('option', { name: new RegExp(first.label) }));
    await expect(args.onSelect).toHaveBeenCalledWith(first);
  },
};

/** マウスを乗せた行が選択に変わる。 */
export const 乗せた行が選ばれる: Story = {
  args: { items: INSERT_COMMANDS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const options = canvas.getAllByRole('option');
    await userEvent.hover(options[2]);
    await expect(options[2]).toHaveAttribute('aria-selected', 'true');
    await expect(options[0]).toHaveAttribute('aria-selected', 'false');
  },
};
