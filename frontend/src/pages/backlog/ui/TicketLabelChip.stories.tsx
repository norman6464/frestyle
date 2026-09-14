import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import TicketLabelChip from './TicketLabelChip';
import type { Label } from '@/entities/ticket';

function label(name: string, color: string): Label {
  return { id: name, name, color, createdAt: '', updatedAt: '' };
}

const meta = {
  title: 'pages/backlog/TicketLabelChip',
  component: TicketLabelChip,
  args: { label: label('不具合', '#1d4ed8') },
} satisfies Meta<typeof TicketLabelChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 暗い色は地に敷いて白文字: Story = {
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByText('不具合');
    await expect(chip).toHaveStyle({ backgroundColor: 'rgb(29, 78, 216)', color: 'rgb(255, 255, 255)' });
  },
};

export const 明るい色は地に敷いて濃い文字: Story = {
  args: { label: label('検索', '#dbeafe') },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByText('検索');
    await expect(chip).toHaveStyle({ backgroundColor: 'rgb(219, 234, 254)', color: 'rgb(25, 25, 25)' });
  },
};

export const 中間の明るさは地に敷かず枠線に落とす: Story = {
  args: { label: label('要調査', '#8b7355') },
  play: async ({ canvasElement }) => {
    const chip = within(canvasElement).getByText('要調査');
    // 地に敷くとどちらの文字色でも読めない明るさ。枠線と点にだけ色を使う。
    await expect(chip).toHaveStyle({ borderColor: 'rgb(139, 115, 85)' });
    await expect(chip).not.toHaveStyle({ backgroundColor: 'rgb(139, 115, 85)' });
  },
};

export const 色が壊れていても消えない: Story = {
  args: { label: label('壊れた色', 'not-a-color') },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('壊れた色')).toBeInTheDocument();
  },
};

export const 並べたところ: Story = {
  render: () => (
    <div className="flex flex-wrap gap-1.5">
      {[
        label('不具合', '#1d4ed8'),
        label('検索', '#dbeafe'),
        label('要調査', '#8b7355'),
        label('今週', '#5c5850'),
      ].map((l) => (
        <TicketLabelChip key={l.id} label={l} />
      ))}
    </div>
  ),
};
