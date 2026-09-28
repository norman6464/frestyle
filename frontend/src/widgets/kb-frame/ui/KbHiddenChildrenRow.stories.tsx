import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import KbHiddenChildrenRow from './KbHiddenChildrenRow';

/**
 * 「この段に、自分には見えないページが在る」ことだけを示す行。
 *
 * **枚数も題名も出さない。** そもそもサーバーが返してこない（返してもいけない）。
 * かといって黙って消すと、木に穴が空いた理由が分からず「壊れている」と読まれる。
 * 在ることだけを示して、それ以上は漏らさない。
 *
 * 押せる行ではないので、木の項目としては数えない。上下移動で止まるのに何も起きない行を
 * 作らないため。
 */
const meta = {
  title: 'widgets/kb-frame/KbHiddenChildrenRow',
  component: KbHiddenChildrenRow,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      // 実物はサイドバーの木（ul）の中に並ぶ。
      <ul className="w-64 bg-surface-1 p-2">
        <Story />
      </ul>
    ),
  ],
} satisfies Meta<typeof KbHiddenChildrenRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** いちばん外側の段。 */
export const 最上段: Story = {
  args: { depth: 0 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('表示できないページがあります')).toBeVisible();
  },
};

/** 段が深いとき。字下げが揃う。 */
export const 深い段: Story = {
  args: { depth: 3 },
};

/** 段ごとの字下げを並べて比べる。 */
export const 字下げの比較: Story = {
  args: { depth: 0 },
  render: () => (
    <>
      {[0, 1, 2, 3].map((depth) => (
        <KbHiddenChildrenRow key={depth} depth={depth} />
      ))}
    </>
  ),
};
