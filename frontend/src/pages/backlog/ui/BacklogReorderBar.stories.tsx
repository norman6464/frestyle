import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import BacklogReorderBar from './BacklogReorderBar';

const meta = {
  title: 'pages/backlog/BacklogReorderBar',
  component: BacklogReorderBar,
  parameters: { layout: 'padded' },
  args: {
    selectedKey: 'FRESTYLE-457',
    isFirst: false,
    isLast: false,
    onMoveUp: fn(),
    onMoveDown: fn(),
    onMoveLast: fn(),
  },
} satisfies Meta<typeof BacklogReorderBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 選択中あり: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /1 つ上へ/ }));
    await expect(args.onMoveUp).toHaveBeenCalled();
  },
};

/** 行を選んでいないときは帯そのものを出さない。押せないボタンと案内文が居座らない。 */
export const 未選択_帯を出さない: Story = {
  args: { selectedKey: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button')).toBeNull();
    await expect(canvasElement.textContent).toBe('');
  },
};

export const 先頭を選択_上へがdisabled: Story = {
  args: { isFirst: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /1 つ上へ/ })).toBeDisabled();
  },
};

export const 末尾を選択_下へと末尾へがdisabled: Story = {
  args: { isLast: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /1 つ下へ/ })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: /末尾へ/ })).toBeDisabled();
  },
};
