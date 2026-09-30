import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import TicketStatusPill from './TicketStatusPill';

const meta = {
  title: 'entities/ticket/TicketStatusPill',
  component: TicketStatusPill,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof TicketStatusPill>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 未着手: Story = {
  args: { name: 'To Do', category: 'todo' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('To Do')).toBeInTheDocument();
  },
};

export const 進行中_選べる: Story = {
  args: { name: '開発', category: 'in_progress', showChevron: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('開発')).toBeInTheDocument();
  },
};

export const 完了: Story = {
  args: { name: 'リリース', category: 'done' },
};

/** 状態の印は色を持たない。形（枠ごとの輪）と名前で読ませ、印も文字色の段で描く。 */
export const 印は色を持たない: Story = {
  args: { name: 'レビュー', category: 'in_progress' },
  play: async ({ canvasElement }) => {
    const icon = canvasElement.querySelector('svg');
    await expect(icon).not.toBeNull();
    await expect(icon?.getAttribute('style') ?? '').not.toContain('color');
    await expect(icon).toHaveClass('text-[var(--color-text-secondary)]');
  },
};
