import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import KbRowActions from './KbRowActions';

/**
 * 行の操作メニュー（⋯）。**文字は本文と同じ黒**で、色を持つのは削除だけ。
 *
 * 色を指定しないと、開いている行（背景に色が付く行）の中に置かれたときにその行の
 * 文字色を継いでしまい、項目が全部青くなる。
 */
const meta = {
  title: 'widgets/kb-frame/KbRowActions',
  component: KbRowActions,
  parameters: { layout: 'centered' },
  args: {
    label: '設計メモ',
    onCreateChild: fn(),
    onRename: fn(),
    onArchive: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof KbRowActions>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 開いている行（親が色を持つ）の中でも、項目は黒いままであること。 */
export const 開いている行の中のメニュー: Story = {
  render: (args) => (
    // 実際の行と同じ入れ物（背景に色が付き、文字色は本文色）。
    <div className="w-64 rounded-md bg-brand-500/10 p-2">
      <div className="group flex items-center justify-between text-[var(--color-text-primary)]">
        <span className="text-sm font-medium">設計メモ</span>
        <KbRowActions {...args} />
      </div>
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // メニューは押したときだけ開く（マウント時の合図では開かない）。
    await userEvent.click(canvas.getByRole('button', { name: '設計メモ の操作' }));
    const rename = await canvas.findByRole('button', { name: '名前を変更' });
    // 継承ではなく明示の色で、本文と同じ黒になっていること。
    const color = getComputedStyle(rename).color;
    const bodyColor = getComputedStyle(document.body).color;
    await expect(color).toBe(bodyColor);
    // 削除だけは赤のまま（戻せない操作を色で区別する）。
    const remove = canvas.getByRole('button', { name: '削除' });
    await expect(getComputedStyle(remove).color).not.toBe(bodyColor);
  },
};
