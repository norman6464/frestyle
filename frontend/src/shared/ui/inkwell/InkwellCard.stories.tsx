import type { Meta, StoryObj } from '@storybook/react-vite';
import InkwellButton from './InkwellButton';
import InkwellCard, { InkwellCardActions, InkwellCardContent } from './InkwellCard';

/**
 * inkwell の面（カード）。影の濃さで「どれくらい浮いているか」を表す。
 *
 * `elevation` は 0・1・2・3・4・8 の 6 段。0 のときだけ影の代わりに枠線を引く
 * （影ゼロだと地色に沈んで、境目が分からなくなるため）。
 */
const meta = {
  title: 'shared/inkwell/InkwellCard',
  component: InkwellCard,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      // 影は地色があってはじめて見える。白の上に白では確かめられない。
      <div className="bg-surface-2 p-8">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InkwellCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定（1 段）。 */
export const 既定: Story = {
  args: {
    children: <InkwellCardContent>ここに中身が入ります。</InkwellCardContent>,
  },
};

/** 影の段を並べて比べる。 */
export const 影の段: Story = {
  args: { children: null },
  render: () => (
    <div className="flex flex-wrap gap-6">
      {([0, 1, 2, 3, 4, 8] as const).map((elevation) => (
        <InkwellCard key={elevation} elevation={elevation} className="w-28">
          <InkwellCardContent className="text-center text-sm">{elevation}</InkwellCardContent>
        </InkwellCard>
      ))}
    </div>
  ),
};

/** 中身と操作を組み合わせた、実際の使い方。 */
export const 中身と操作: Story = {
  args: { children: null },
  render: () => (
    <InkwellCard className="max-w-sm" elevation={2}>
      <InkwellCardContent>
        <h3 className="mb-1 text-base font-medium">スペースを削除しますか？</h3>
        <p className="text-sm text-inkwell-text-secondary">
          中のページもまとめて消えます。元には戻せません。
        </p>
      </InkwellCardContent>
      <InkwellCardActions className="justify-end">
        <InkwellButton variant="text">やめる</InkwellButton>
        <InkwellButton variant="text" color="error">
          削除する
        </InkwellButton>
      </InkwellCardActions>
    </InkwellCard>
  ),
};
