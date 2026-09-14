import type { Meta, StoryObj } from '@storybook/react-vite';
import { AxiosError, AxiosHeaders } from 'axios';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import TicketTypeAdmin from './TicketTypeAdmin';
import type { TicketType, TicketTypeInput } from '@/entities/ticket';

function apiError(status: number, code: string): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: code },
  });
}

function type(over: Partial<TicketType>): TicketType {
  return {
    id: 'ty-1',
    workspaceId: 'w-1',
    projectId: 's-1',
    name: '開発タスク',
    hierarchyLevel: 0,
    color: '#2563eb',
    position: 'a0',
    isDefault: true,
    templateTitle: null,
    templateDoc: null,
    archivedAt: null,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    activeTicketCount: 0,
    ...over,
  };
}

const types: TicketType[] = [
  type({ id: 'ty-1', name: '設計', hierarchyLevel: 1, isDefault: false, color: '#7c3aed', activeTicketCount: 1 }),
  type({ id: 'ty-2', name: '開発タスク', hierarchyLevel: 0, isDefault: true, activeTicketCount: 2 }),
];

const meta = {
  title: 'pages/backlog/TicketTypeAdmin',
  component: TicketTypeAdmin,
  parameters: { layout: 'padded' },
  args: {
    types,
    onCreate: fn(async (input: TicketTypeInput) => type({ id: 'ty-new', ...input })),
    onSetDefault: fn(async () => {}),
    onArchive: fn(async () => {}),
  },
} satisfies Meta<typeof TicketTypeAdmin>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 一覧: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('設計')).toBeInTheDocument();
    await expect(canvas.getByText('開発タスク')).toBeInTheDocument();
  },
};

export const 追加: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('種別の名前'), 'バグ');
    await userEvent.click(canvas.getByRole('button', { name: '追加' }));
    await waitFor(() =>
      expect(args.onCreate).toHaveBeenCalledWith({ name: 'バグ', hierarchyLevel: 0, color: '#2563eb' }),
    );
  },
};

export const 既定の切替: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'これにする' }));
    await waitFor(() => expect(args.onSetDefault).toHaveBeenCalledWith('ty-1'));
  },
};

export const 使用中のアーカイブが409: Story = {
  args: { onArchive: fn(async () => Promise.reject(apiError(409, 'type_in_use'))) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getAllByRole('button', { name: 'アーカイブ' })[0]);
    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('件のチケットで使われています');
    });
  },
};

export const 名前の重複が409: Story = {
  args: { onCreate: fn(async (_input: TicketTypeInput) => Promise.reject(apiError(409, 'type_name_taken'))) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('種別の名前'), '設計');
    await userEvent.click(canvas.getByRole('button', { name: '追加' }));
    await waitFor(async () => {
      await expect(canvas.getByText('同じ名前の種別が既にあります。')).toBeInTheDocument();
    });
  },
};
