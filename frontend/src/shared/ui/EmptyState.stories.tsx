import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import EmptyState from './EmptyState';
import { fsIcon } from './icons/fsIconFactory';

/**
 * 中身がまだ何も無いところに出す案内。
 *
 * **行き止まりにしない**のが役目。「ありません」で終えると次に何をすればいいか分からないので、
 * できるときは `action` で次の一歩を置く。
 */
const meta = {
  title: 'shared/EmptyState',
  component: EmptyState,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="h-72 w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 見出しだけ。 */
export const 見出しだけ: Story = {
  args: { icon: fsIcon('document-text'), title: 'まだページがありません' },
};

/** 説明を添える。 */
export const 説明つき: Story = {
  args: {
    icon: fsIcon('document-text'),
    title: 'まだページがありません',
    description: '左の ＋ から最初のページを作れます。',
  },
};

/** 次の一歩を置く。行き止まりにしない形。 */
export const 次の一歩つき: Story = {
  args: {
    icon: fsIcon('document-text'),
    title: 'まだページがありません',
    description: '最初のページを作って書きはじめましょう。',
    action: { label: 'ページを作る', onClick: fn() },
  },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'ページを作る' }));
    await expect(args.action?.onClick).toHaveBeenCalledTimes(1);
  },
};

/** 検索して見つからなかったとき。 */
export const 検索結果なし: Story = {
  args: {
    icon: fsIcon('search'),
    title: '見つかりませんでした',
    description: '別の言葉で探してみてください。',
  },
};

/** 通知が無いとき。 */
export const 通知なし: Story = {
  args: { icon: fsIcon('bell'), title: '新しい知らせはありません' },
};
