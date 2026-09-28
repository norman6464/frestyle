import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import KbSectionHeading from './KbSectionHeading';

/**
 * サイドバーの節の見出し（「チームスペース」「プライベート」）。
 *
 * 見本と同じく、**普段は文字だけ**で、触れているときに ＋ と ⋯ が現れる。
 * 節が続くところには上に線を引き、どこからが別の区分かを示す。
 */
const meta = {
  title: 'widgets/kb-frame/KbSectionHeading',
  component: KbSectionHeading,
  parameters: { layout: 'centered' },
  args: { onAdd: fn(), addLabel: 'スペースを追加' },
  decorators: [
    (Story) => (
      // 実物のサイドバーと同じ幅・同じ地色で見る。
      <div className="w-64 bg-surface-1 p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbSectionHeading>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 触れていないとき。操作は隠れて、文字だけが見える。 */
export const 普段の見え方: Story = {
  args: { label: 'チームスペース' },
};

/** 触れているとき。＋ と ⋯ が現れる。 */
export const ホバーしたとき: Story = {
  args: {
    label: 'プライベート',
    addLabel: 'プライベートスペースを追加',
    menuItems: [{ label: 'プライベートスペースを作成', onSelect: fn() }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // CSS の :hover は JS から起こせないので、focus で focus-within を効かせて
    // 「操作が現れた状態」を絵に出す（実物のホバーと同じ見え方になる）。
    canvas.getByRole('button', { name: 'プライベートスペースを追加' }).focus();
    // 濃くなり切るまで待つ。transition-opacity の途中で見ると 0 のまま読める。
    // toBeVisible は親の opacity を見ないので、**不透明度そのもの**を確かめる。
    const actions = canvas.getByRole('button', { name: 'プライベート の操作' })
      .parentElement as HTMLElement;
    await waitFor(
      async () => {
        await expect(getComputedStyle(actions).opacity).toBe('1');
      },
      { timeout: 5000 },
    );
  },
};

/** 上に線を引いた節（チームの木のあとに置くプライベート）。 */
export const 区切り線つき: Story = {
  args: {
    label: 'プライベート',
    divider: true,
    addLabel: 'プライベートスペースを追加',
    menuItems: [{ label: 'プライベートスペースを作成', onSelect: fn() }],
  },
};

/** ⋯ を押してメニューを開いたところ。 */
export const メニューを開いたところ: Story = {
  args: {
    label: 'プライベート',
    divider: true,
    addLabel: 'プライベートスペースを追加',
    menuItems: [{ label: 'プライベートスペースを作成', onSelect: fn() }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'プライベート の操作' }));
    await expect(
      await canvas.findByRole('button', { name: 'プライベートスペースを作成' }),
    ).toBeVisible();
  },
};
