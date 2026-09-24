import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import TicketTypeGlyph from './TicketTypeGlyph';
import type { TicketType } from '../model/types';

const type = (name: string, color: string): TicketType => ({
  id: `ty-${name}`,
  workspaceId: 'w-1',
  projectId: 'p-1',
  name,
  hierarchyLevel: 0,
  color,
  position: 'a0',
  isDefault: false,
  templateTitle: null,
  templateDoc: null,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  activeTicketCount: 0,
});

const meta = {
  title: 'entities/ticket/TicketTypeGlyph',
  component: TicketTypeGlyph,
  parameters: { layout: 'padded' },
  args: { type: type('開発タスク', '#2563eb') },
} satisfies Meta<typeof TicketTypeGlyph>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 濃い地には白い文字。 */
export const 濃い色: Story = {
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: '種別: 開発タスク' });
    await expect(glyph).toHaveAttribute('data-paint', 'solid');
    await expect(glyph).toHaveStyle({ color: 'rgb(255, 255, 255)' });
  },
};

/** 明るい地（黄色）には濃い文字。白い文字だと読めない（2.15:1）。 */
export const 明るい色: Story = {
  args: { type: type('調査', '#f59e0b') },
  play: async ({ canvasElement }) => {
    const glyph = within(canvasElement).getByRole('img', { name: '種別: 調査' });
    await expect(glyph).toHaveAttribute('data-paint', 'solid');
    await expect(glyph).toHaveStyle({ color: 'rgb(25, 25, 25)' });
  },
};

/** 白でも濃い文字でも基準に届かない中くらいの明るさは、地に敷かずに枠だけに色を使う。 */
export const 中くらいの色: Story = {
  args: { type: type('バグ', '#d9502b') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: '種別: バグ' })).toHaveAttribute('data-paint', 'outline');
  },
};

/** 並べて見比べる。 */
export const 並べる: Story = {
  render: () => (
    <div className="flex gap-3">
      {[
        type('束ね', '#7c3aed'),
        type('開発タスク', '#2563eb'),
        type('調査', '#f59e0b'),
        type('バグ', '#d9502b'),
        type('小作業', '#2f6b47'),
        type('淡い', '#e5e7eb'),
      ].map((t) => (
        <TicketTypeGlyph key={t.id} type={t} />
      ))}
    </div>
  ),
};
