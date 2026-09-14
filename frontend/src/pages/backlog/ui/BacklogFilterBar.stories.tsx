import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import BacklogFilterBar from './BacklogFilterBar';
import type { Label, TicketStatus, TicketType } from '@/entities/ticket';

const statuses: TicketStatus[] = [
  {
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
    activeTicketCount: 4,
  },
  {
    id: 'st-2',
    workspaceId: 'w-1',
    projectId: 's-1',
    name: '開発',
    category: 'in_progress',
    color: '#a0661a',
    position: 'a1',
    isInitial: false,
    archivedAt: null,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    activeTicketCount: 2,
  },
];

const types: TicketType[] = [
  {
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
    activeTicketCount: 3,
  },
];

const labels: Label[] = [
  { id: 'l-1', name: '不具合', color: '#b3392c', createdAt: '', updatedAt: '' },
  { id: 'l-2', name: 'frontend', color: '#2f6b47', createdAt: '', updatedAt: '' },
];

const meta = {
  title: 'pages/backlog/BacklogFilterBar',
  component: BacklogFilterBar,
  parameters: { layout: 'padded' },
  args: {
    statuses,
    types,
    labels,
    statusId: null,
    typeId: null,
    labelId: null,
    assignedToMe: false,
    q: '',
    onChangeStatusId: fn(),
    onChangeTypeId: fn(),
    onChangeLabelId: fn(),
    onToggleAssignedToMe: fn(),
    onChangeQuery: fn(),
  },
} satisfies Meta<typeof BacklogFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 既定: Story = {};

export const 状態を選ぶ: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText('状態で絞り込む'), 'st-2');
    await expect(args.onChangeStatusId).toHaveBeenCalledWith('st-2');
  },
};

export const ラベルを選ぶ: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText('ラベルで絞り込む'), 'l-1');
    await expect(args.onChangeLabelId).toHaveBeenCalledWith('l-1');
  },
};

export const 種別を選ぶ: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText('種別で絞り込む'), 'ty-1');
    await expect(args.onChangeTypeId).toHaveBeenCalledWith('ty-1');
  },
};

export const 担当自分を押す: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '担当: 自分' }));
    await expect(args.onToggleAssignedToMe).toHaveBeenCalledWith(true);
  },
};

export const 担当自分は選択中の見た目: Story = {
  args: { assignedToMe: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '担当: 自分' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  },
};

export const 題名検索は入力が止まってから通知する: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('題名で絞り込む');
    await userEvent.type(input, '認証');
    // デバウンス中はまだ呼ばれない。
    await expect(args.onChangeQuery).not.toHaveBeenCalled();
    await waitFor(() => expect(args.onChangeQuery).toHaveBeenCalledWith('認証'), { timeout: 1000 });
  },
};
