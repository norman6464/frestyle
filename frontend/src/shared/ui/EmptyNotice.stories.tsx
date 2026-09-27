import type { Meta, StoryObj } from '@storybook/react-vite';
import EmptyNotice from './EmptyNotice';

/**
 * 区画の中の一覧が 0 件であること。画面全体が空のときは EmptyState を使う。
 * できるときは次の操作を添えて、行き止まりにしない。
 */
const meta = {
  title: 'shared/EmptyNotice',
  component: EmptyNotice,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="max-w-md">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptyNotice>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 右のパネル・サイドバーの中。 */
export const 小さな一言: Story = {
  args: { title: 'まだコメントはありません。' },
};

/** 本文の中の一覧の場所。次の操作を添える。 */
export const 区画: Story = {
  args: {
    title: 'お気に入りはまだありません',
    variant: 'panel',
    children: 'ページの右上の星を押すと、ここに並びます。',
  },
};
