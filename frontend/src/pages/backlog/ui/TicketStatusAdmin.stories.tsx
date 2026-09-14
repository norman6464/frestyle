import type { Meta, StoryObj } from '@storybook/react-vite';
import { AxiosError, AxiosHeaders } from 'axios';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import TicketStatusAdmin from './TicketStatusAdmin';
import type { TicketStatus } from '@/entities/ticket';

/**
 * getApiError は `instanceof AxiosError` で判定するため、投げるのは本物の AxiosError
 * インスタンスにする（プレーンな `{isAxiosError:true}` は素通りしない。
 * KbSaveAsTemplateButton.stories.tsx と同じ流儀）。
 */
function apiError(status: number, code: string): AxiosError {
  return new AxiosError('failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { error: code },
  });
}

function status(over: Partial<TicketStatus>): TicketStatus {
  return {
    id: 'st-1',
    workspaceId: 'w-1',
    projectId: 's-1',
    name: 'To Do',
    category: 'todo',
    color: '#5b6b7a',
    position: 'a0',
    isInitial: true,
    archivedAt: null,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    activeTicketCount: 0,
    ...over,
  };
}

const statuses: TicketStatus[] = [
  status({ id: 'st-1', name: 'To Do', isInitial: true, activeTicketCount: 1 }),
  status({ id: 'st-2', name: '開発', category: 'in_progress', color: '#a0661a', isInitial: false, activeTicketCount: 2 }),
];

const meta = {
  title: 'pages/backlog/TicketStatusAdmin',
  component: TicketStatusAdmin,
  parameters: { layout: 'padded' },
  args: {
    statuses,
    onCreate: fn(async (input) => status({ id: 'st-new', ...input })),
    onSetInitial: fn(async () => {}),
    onArchive: fn(async () => {}),
  },
} satisfies Meta<typeof TicketStatusAdmin>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 一覧: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('To Do')).toBeInTheDocument();
    await expect(canvas.getByText('開発')).toBeInTheDocument();
  },
};

export const 追加: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('状態の名前'), 'レビュー中');
    await userEvent.click(canvas.getByRole('button', { name: '追加' }));
    await waitFor(() =>
      expect(args.onCreate).toHaveBeenCalledWith({ name: 'レビュー中', category: 'todo', color: '#5b6b7a' }),
    );
  },
};

export const 初期状態の切替: Story = {
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'これにする' }));
    await waitFor(() => expect(args.onSetInitial).toHaveBeenCalledWith('st-2'));
  },
};

export const 使用中のアーカイブが409: Story = {
  args: {
    onArchive: fn(async () => {
      throw apiError(409, 'status_in_use');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const archiveButtons = canvas.getAllByRole('button', { name: 'アーカイブ' });
    await userEvent.click(archiveButtons[0]);
    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('件のチケットで使われているため、アーカイブできません');
    });
  },
};

export const 名前の重複が409: Story = {
  args: {
    onCreate: fn(async (_input) => {
      throw apiError(409, 'status_name_taken');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('状態の名前'), 'To Do');
    await userEvent.click(canvas.getByRole('button', { name: '追加' }));
    await waitFor(async () => {
      await expect(canvas.getByText('同じ名前の状態が既にあります。')).toBeInTheDocument();
    });
  },
};

export const 初期状態はアーカイブできない: Story = {
  args: {
    onArchive: fn(async () => {
      throw apiError(400, 'invalid_request');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const archiveButtons = canvas.getAllByRole('button', { name: 'アーカイブ' });
    await userEvent.click(archiveButtons[0]);
    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('初期状態はアーカイブできません');
    });
  },
};
