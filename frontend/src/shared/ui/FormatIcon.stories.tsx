import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import FormatIcon, { type FormatIconName } from './FormatIcon';

const ALL: FormatIconName[] = [
  'bold',
  'italic',
  'strikethrough',
  'heading',
  'list',
  'list-ordered',
  'code',
  'code-block',
  'quote',
  'link',
  'undo',
  'redo',
];

const meta = {
  title: 'shared/FormatIcon',
  component: FormatIcon,
  args: { name: 'bold' },
} satisfies Meta<typeof FormatIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 書式バーに並ぶ全種。見た目の確認はここで済ませる —— 手で書いた path なので、
 * 形が崩れていても型では分からない。
 */
export const 全種: Story = {
  render: () => (
    <div className="flex flex-wrap gap-4 p-4 text-[var(--color-text-secondary)]">
      {ALL.map((name) => (
        <span key={name} className="flex w-20 flex-col items-center gap-1">
          <span className="grid h-8 w-8 place-items-center rounded-md border border-surface-3 text-[18px]">
            <FormatIcon name={name} />
          </span>
          <span className="text-[10px] text-[var(--color-text-muted)]">{name}</span>
        </span>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    // 12 種すべてが線を持って描かれている（空の svg になっていない）。
    const svgs = canvasElement.querySelectorAll('svg');
    await expect(svgs.length).toBe(ALL.length);
    svgs.forEach((svg) => expect(svg.querySelectorAll('path').length).toBeGreaterThan(0));
  },
};

/** 大きさと色は隣の文字に従う（1em / currentColor）。 */
export const 文字に揃う: Story = {
  render: () => (
    <p className="p-4 text-2xl text-brand-700">
      あ<FormatIcon name="bold" />あ
    </p>
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(/あ/)).toBeInTheDocument();
  },
};
