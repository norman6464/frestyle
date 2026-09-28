import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect } from 'storybook/test';
import KbPageGroupIcon from './KbPageGroupIcon';

/**
 * ナレッジの木で「子を持つページ（閉じている）」を表す印。
 *
 * 形はフォルダだが、**中に本文の行が入っている**。素のフォルダにしないのは、この仕組みでは
 * 親が単なる入れ物ではなく **自分も中身を持つページ** だから。空のフォルダにすると
 * 「押しても本文が無い」と読まれてしまう。
 */
const meta = {
  title: 'entities/kb/pageIcons/KbPageGroupIcon',
  component: KbPageGroupIcon,
  parameters: { layout: 'centered' },
  args: { className: 'h-6 w-6 text-[var(--color-text-secondary)]' },
} satisfies Meta<typeof KbPageGroupIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定。 */
export const 既定: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-icon="page-group"]')).not.toBeNull();
  },
};

/** 大きさを変えても潰れない。 */
export const 大きさ: Story = {
  args: {},
  render: (args) => (
    <div className="flex items-end gap-4 text-[var(--color-text-secondary)]">
      <KbPageGroupIcon {...args} className="h-4 w-4" />
      <KbPageGroupIcon {...args} className="h-6 w-6" />
      <KbPageGroupIcon {...args} className="h-10 w-10" />
    </div>
  ),
};
