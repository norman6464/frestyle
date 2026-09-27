import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import SkeletonRows from './SkeletonRows';

/**
 * 読み込み中の骨組み。行の形を保ったまま待たせ、読み終わったときに並びが跳ねないようにする。
 * 状態は status の名前で伝え、線そのものは読み上げない。
 */
const meta = {
  title: 'shared/SkeletonRows',
  component: SkeletonRows,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SkeletonRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 一覧の行（題名と補足）。 */
export const 一覧の行: Story = {
  args: { label: 'お気に入りを読み込み中' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status', { name: 'お気に入りを読み込み中' })).toBeInTheDocument();
  },
};

/** 高さをそろえた塊。右のパネルのコメント・提案など。 */
export const 塊: Story = {
  args: { label: 'コメントを読み込み中', shape: 'blocks', size: 'lg' },
};

/** 入力欄 1 つぶんの高さ。権限の一覧・テンプレートの選択など。 */
export const 低い塊: Story = {
  args: { label: 'テンプレートを読み込み中', shape: 'blocks', size: 'sm', rows: 3 },
};
