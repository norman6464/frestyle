import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import MentionMenuList from './MentionMenuList';
import type { WorkspaceMember } from '@/entities/workspace';

const MEMBERS: WorkspaceMember[] = [
  { principalId: 'p-1', userId: 1, name: 'norman6464' },
  { principalId: 'p-2', userId: 2, name: '佐藤 花子' },
  { principalId: 'p-3', userId: 3, name: '田中 太郎' },
];

/**
 * 発言の入力欄で '@' を打ったときに出る、名指す相手の候補一覧。
 * SlashMenuList と同じ形（矢印キーで選び、Enter で決める。フォーカスは入力欄に残る）。
 */
const meta = {
  title: 'pages/backlog/MentionMenuList',
  component: MentionMenuList,
  parameters: { layout: 'centered' },
  args: { onSelect: fn(), listboxId: 'ticket-mention' },
  decorators: [
    (Story) => (
      <div className="w-56">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MentionMenuList>;

export default meta;
type Story = StoryObj<typeof meta>;

/** '@' を打った直後。候補が全員出る。 */
export const 一覧: Story = {
  args: { items: MEMBERS },
  play: async ({ canvasElement }) => {
    const options = within(canvasElement).getAllByRole('option');
    await expect(options[0]).toHaveAttribute('aria-selected', 'true');
    await expect(options).toHaveLength(3);
  },
};

/** どれにも当たらないとき。行き止まりにせず、その旨を出す。 */
export const 該当なし: Story = {
  args: { items: [] },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('該当する人がいません')).toBeVisible();
  },
};

/** 押すと、その相手が親へ渡る。 */
export const 選んだとき: Story = {
  args: { items: MEMBERS },
  play: async ({ args, canvasElement }) => {
    const target = MEMBERS[1];
    // option の読み上げ名はアバターの頭文字＋氏名になる（Avatar のフォールバック表示が
    // 装飾ではなく地の文字として入るため。SlashMenuList.stories.tsx と同じく正規表現で探す）。
    await userEvent.click(within(canvasElement).getByRole('option', { name: new RegExp(target.name) }));
    await expect(args.onSelect).toHaveBeenCalledWith(target);
  },
};

/** マウスを乗せた行が選択に変わる。 */
export const 乗せた行が選ばれる: Story = {
  args: { items: MEMBERS },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const options = canvas.getAllByRole('option');
    await userEvent.hover(options[2]);
    await expect(options[2]).toHaveAttribute('aria-selected', 'true');
    await expect(options[0]).toHaveAttribute('aria-selected', 'false');
  },
};
