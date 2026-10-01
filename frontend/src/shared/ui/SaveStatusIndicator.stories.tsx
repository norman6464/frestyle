import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import SaveStatusIndicator from './SaveStatusIndicator';

/**
 * 本文がいま保存されているかを示す、小さな文字。
 *
 * 保存そのもの（打ち終わりを待つ・送る・衝突を見る）は画面側の仕事で、この部品は
 * 受け取った状態を出すだけ。
 *
 * `idle`（まだ何も起きていない）のときは**何も描かない**。「未保存でも保存済みでもない」
 * ことを文字で出しても意味が無く、場所を取るだけのため。
 */
const meta = {
  title: 'shared/SaveStatusIndicator',
  component: SaveStatusIndicator,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SaveStatusIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** まだ何も起きていない。何も出ない。 */
export const 何も出ない: Story = {
  args: { status: 'idle' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('status')).toBeNull();
  },
};

/** 打ったが、まだ送っていない。 */
export const 未保存: Story = {
  args: { status: 'unsaved' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('未保存');
  },
};

/** 送っている最中。 */
export const 保存中: Story = {
  args: { status: 'saving' },
};

/** 送り終わった。 */
export const 保存済み: Story = {
  args: { status: 'saved' },
};

/** 移り変わりを並べて見る（未保存 → 保存中 → 保存済み）。 */
export const 移り変わり: Story = {
  args: { status: 'idle' },
  render: () => (
    <div className="flex items-center gap-6">
      <SaveStatusIndicator status="unsaved" />
      <SaveStatusIndicator status="saving" />
      <SaveStatusIndicator status="saved" />
    </div>
  ),
};
