import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import TicketLabelBar from './TicketLabelBar';
import type { Label } from '@/entities/ticket';

function label(id: string, name: string, color: string): Label {
  return { id, name, color, createdAt: '', updatedAt: '' };
}

const allLabels: Label[] = [
  label('l-1', '不具合', '#1d4ed8'),
  label('l-2', '検索', '#dbeafe'),
  label('l-3', '要調査', '#8b7355'),
  label('l-4', '今週', '#5c5850'),
  label('l-5', '緊急', '#b3392c'),
  label('l-6', '改善', '#357a34'),
];

const meta = {
  title: 'pages/backlog/TicketLabelBar',
  component: TicketLabelBar,
  args: {
    attached: [allLabels[0], allLabels[2]],
    allLabels,
    canEdit: true,
    onToggle: fn(),
    onCreate: fn(async (name, color) => label('l-new', name, color)),
  },
  decorators: [(Story) => <div className="w-80 bg-surface-1 p-3"><Story /></div>],
} satisfies Meta<typeof TicketLabelBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 編集できる: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('不具合')).toBeInTheDocument();
    await expect(canvas.getByText('要調査')).toBeInTheDocument();
    await expect(canvas.getByLabelText('ラベルを追加')).toBeInTheDocument();
  },
};

export const 読むだけではボタンを出さない: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('不具合')).toBeInTheDocument();
    await expect(canvas.queryByLabelText('ラベルを追加')).toBeNull();
  },
};

export const ラベルが0件で読むだけなら何も出さない: Story = {
  args: { canEdit: false, attached: [] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/./)).toBeNull();
    await expect(canvas.queryByRole('button')).toBeNull();
  },
};

export const ピッカーを開く: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('ラベルを追加'));
    await expect(canvas.getByLabelText('ラベルを絞り込む')).toBeInTheDocument();
    // 付いているものにはチェックが付く。
    await expect(canvas.getByLabelText('ラベル 不具合 を外す')).toBeInTheDocument();
    await expect(canvas.getByLabelText('ラベル 検索 を付ける')).toBeInTheDocument();
  },
};

export const 絞り込み: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('ラベルを追加'));
    await userEvent.type(canvas.getByLabelText('ラベルを絞り込む'), '今週');
    await expect(canvas.getByLabelText('ラベル 今週 を付ける')).toBeInTheDocument();
    await expect(canvas.queryByLabelText('ラベル 検索 を付ける')).toBeNull();
  },
};

export const 新しいラベルを作る: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('ラベルを追加'));
    await userEvent.type(canvas.getByLabelText('新しいラベルの名前'), '緊急対応');
    await userEvent.click(canvas.getByRole('button', { name: '作る' }));
    await waitFor(async () => {
      await expect(args.onCreate).toHaveBeenCalledWith('緊急対応', expect.any(String));
    });
  },
};

export const 名前が重複すると断られる: Story = {
  args: {
    onCreate: fn(async (_name: string, _color: string): Promise<Label> => {
      const err = new Error('taken') as Error & { isAxiosError: boolean; response: unknown };
      err.isAxiosError = true;
      err.response = { status: 409, data: { error: 'label_name_taken' } };
      throw err;
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('ラベルを追加'));
    await userEvent.type(canvas.getByLabelText('新しいラベルの名前'), '不具合');
    await userEvent.click(canvas.getByRole('button', { name: '作る' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('既にあります');
    });
  },
};
