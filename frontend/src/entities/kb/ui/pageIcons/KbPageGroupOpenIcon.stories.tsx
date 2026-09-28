import type { Meta, StoryObj } from '@storybook/react-vite';
import KbPageGroupOpenIcon from './KbPageGroupOpenIcon';
import KbPageGroupIcon from './KbPageGroupIcon';

/**
 * ナレッジの木で「子を持つページ（開いている）」を表す印。
 *
 * 閉じているときの印と**対で見る**もの。開くと形が変わることで、いま中が見えている行が
 * どれなのかを、色の濃さに頼らずに示せる。
 */
const meta = {
  title: 'entities/kb/pageIcons/KbPageGroupOpenIcon',
  component: KbPageGroupOpenIcon,
  parameters: { layout: 'centered' },
  args: { className: 'h-6 w-6 text-[var(--color-text-secondary)]' },
} satisfies Meta<typeof KbPageGroupOpenIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定。 */
export const 既定: Story = {
  args: {},
};

/** 閉じているときと並べて、開閉の差を見る。 */
export const 開閉を比べる: Story = {
  args: {},
  render: (args) => (
    <div className="flex items-center gap-8 text-[var(--color-text-secondary)]">
      <div className="flex flex-col items-center gap-2">
        <KbPageGroupIcon className="h-7 w-7" />
        <span className="text-xs text-[var(--color-text-muted)]">閉</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <KbPageGroupOpenIcon {...args} className="h-7 w-7" />
        <span className="text-xs text-[var(--color-text-muted)]">開</span>
      </div>
    </div>
  ),
};
