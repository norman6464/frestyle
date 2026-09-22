import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import TicketCreateRow from './TicketCreateRow';

const meta = {
  title: 'pages/backlog/TicketCreateRow',
  component: TicketCreateRow,
  parameters: { layout: 'padded' },
  args: { onCreate: fn(async () => {}) },
  // 作成行は表の 1 行（role="row"）。表の外に単独で置くと役割の親子関係が崩れるので、器を用意する。
  decorators: [
    (Story) => (
      <div role="table" aria-label="チケット" className="w-[720px] border border-surface-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof TicketCreateRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Enterで作成: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('新しいチケットの題名');
    // 打ち始めると「追加」が現れる（空のうちは出ない）。
    await expect(canvas.queryByRole('button', { name: '追加' })).toBeNull();
    await userEvent.type(input, '新しいチケット');
    await expect(canvas.getByRole('button', { name: '追加' })).toBeInTheDocument();
    await userEvent.type(input, '{Enter}');
    await waitFor(() => expect(args.onCreate).toHaveBeenCalledWith('新しいチケット'));
    await expect(input).toHaveValue('');
  },
};

export const 空のまま送信しない: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('新しいチケットの題名'), '   {Enter}');
    await expect(args.onCreate).not.toHaveBeenCalled();
  },
};

export const 失敗すると文言を出す: Story = {
  args: { onCreate: fn(async () => Promise.reject(new Error('failed'))) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('新しいチケットの題名'), '失敗するはず{Enter}');
    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('チケットを作成できませんでした。');
    });
  },
};
