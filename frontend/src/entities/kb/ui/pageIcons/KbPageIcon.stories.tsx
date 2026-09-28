import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import KbPageGroupIcon from './KbPageGroupIcon';
import KbPageGroupOpenIcon from './KbPageGroupOpenIcon';
import KbPageIcon from './KbPageIcon';

/**
 * ナレッジの木で「これ以上たどれないページ」を表す印。
 *
 * 折れた角のある紙に、本文の行が 2 本。この **2 本の行を親のページの印も持っている** のが
 * 大事なところで、「どちらもページである」ことを形で揃えている。
 *
 * 色は指定していない。置いた場所の文字色をそのまま継ぐので、選択中の行では文字と一緒に濃くなる。
 */
const meta = {
  title: 'entities/kb/pageIcons/KbPageIcon',
  component: KbPageIcon,
  parameters: { layout: 'centered' },
  args: { className: 'h-6 w-6 text-[var(--color-text-secondary)]' },
} satisfies Meta<typeof KbPageIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定。 */
export const 既定: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    // 飾りとして読み上げから隠してあるので、role でも名前でも引けない。
    // どの印が出ているかは data-icon で見分ける。
    await expect(canvasElement.querySelector('[data-icon="page"]')).not.toBeNull();
    await expect(within(canvasElement).queryByRole('img')).toBeNull();
  },
};

/** 小さくしても潰れないことを確かめる（サイドバーは 16px で使う）。 */
export const 小さいとき: Story = {
  args: {},
  render: (args) => (
    <div className="flex items-end gap-4 text-[var(--color-text-secondary)]">
      <KbPageIcon {...args} className="h-4 w-4" />
      <KbPageIcon {...args} className="h-6 w-6" />
      <KbPageIcon {...args} className="h-10 w-10" />
    </div>
  ),
};

/** 文字色を継ぐ。 */
export const 色を継ぐ: Story = {
  args: {},
  render: (args) => (
    <div className="flex items-center gap-6">
      <span className="text-[var(--color-text-muted)]">
        <KbPageIcon {...args} className="h-6 w-6" />
      </span>
      <span className="text-[var(--color-text-primary)]">
        <KbPageIcon {...args} className="h-6 w-6" />
      </span>
      <span className="text-brand-600">
        <KbPageIcon {...args} className="h-6 w-6" />
      </span>
    </div>
  ),
};

/** 3 つの印を並べる。同じ族に見えることが狙い。 */
export const 三兄弟: Story = {
  args: {},
  render: () => (
    <div className="flex items-center gap-8 text-[var(--color-text-secondary)]">
      {[
        ['末端のページ', <KbPageIcon key="p" className="h-7 w-7" />],
        ['子を持つページ（閉）', <KbPageGroupIcon key="g" className="h-7 w-7" />],
        ['子を持つページ（開）', <KbPageGroupOpenIcon key="o" className="h-7 w-7" />],
      ].map(([label, icon]) => (
        <div key={String(label)} className="flex flex-col items-center gap-2">
          {icon}
          <span className="text-xs text-[var(--color-text-muted)]">{label}</span>
        </div>
      ))}
    </div>
  ),
};
