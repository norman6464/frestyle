import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { MemoryRouter } from 'react-router-dom';
import TicketChildrenList from './TicketChildrenList';
import type { Ticket, TicketStatus } from '@/entities/ticket';

function status(over: Partial<TicketStatus> & { id: string }): TicketStatus {
  return {
    workspaceId: 'w-1',
    projectId: 's-1',
    name: 'To Do',
    category: 'todo',
    color: '#5b6b7a',
    position: 'a0',
    isInitial: true,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    activeTicketCount: 0,
    ...over,
  };
}

const statuses: TicketStatus[] = [
  status({ id: 'st-1', name: 'To Do', color: '#5b6b7a', category: 'todo' }),
  status({ id: 'st-2', name: '完了', color: '#357a34', category: 'done' }),
];

function child(over: Partial<Ticket> & { id: string }): Ticket {
  return {
    workspaceId: 'w-1',
    projectId: 's-1',
    number: 10,
    typeId: 'ty-1',
    statusId: 'st-1',
    parentId: 'parent-1',
    title: '子チケット',
    doc: { type: 'doc', content: [] },
    priority: 2,
    storyPoints: null,
    teamId: null,
    startDate: null,
    dueDate: null,
    position: 'a0',
    closedAt: null,
    resolution: null,
    createdByUserId: 1,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    assigneePrincipalId: null,
    labels: [],
    ...over,
  };
}

const meta = {
  title: 'pages/backlog/TicketChildrenList',
  component: TicketChildrenList,
  args: { tickets: [], loading: false, error: null, projectKey: 'FRESTYLE', statuses },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="w-72 bg-surface-1 p-3">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof TicketChildrenList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 子なし: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('子チケットはありません')).toBeInTheDocument();
  },
};

export const 子あり: Story = {
  args: {
    tickets: [
      child({ id: 'c-1', number: 10, title: '設計する', statusId: 'st-1' }),
      child({ id: 'c-2', number: 11, title: '実装する', statusId: 'st-2' }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('設計する')).toBeInTheDocument();
    await expect(canvas.getByText('実装する')).toBeInTheDocument();
    await expect(canvas.getByText('完了')).toBeInTheDocument();
    await expect(canvas.getAllByRole('link')).toHaveLength(2);
  },
};

export const 読込中: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toBeInTheDocument();
  },
};

export const 失敗: Story = {
  args: { error: '子チケットを読み込めませんでした。' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('読み込めませんでした');
  },
};
