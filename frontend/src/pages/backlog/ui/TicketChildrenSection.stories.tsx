import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { MemoryRouter } from 'react-router-dom';
import TicketChildrenSection from './TicketChildrenSection';
import { withApi } from '../../../../.storybook/decorators';
import type { Ticket, TicketStatus } from '@/entities/ticket';

const statuses: TicketStatus[] = [
  {
    workspaceId: 'w-1',
    projectId: 's-1',
    id: 'st-1',
    name: 'To Do',
    category: 'todo',
    color: '#5b6b7a',
    position: 'a0',
    isInitial: true,
    archivedAt: null,
    createdAt: '',
    updatedAt: '',
    activeTicketCount: 0,
  },
];

function childWire(over: Record<string, unknown> & { id: string }) {
  return {
    workspaceId: 'w-1',
    projectId: 's-1',
    number: 10,
    typeId: 'ty-1',
    statusId: 'st-1',
    parentId: 't-1',
    title: '子チケット',
    doc: { type: 'doc', content: [] },
    priority: 2,
    position: 'a0',
    createdByUserId: 1,
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    ...over,
  };
}

const meta = {
  title: 'pages/backlog/TicketChildrenSection',
  component: TicketChildrenSection,
  args: { workspaceSlug: 'acme', ticketId: 't-1', projectKey: 'FRESTYLE', statuses },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <div className="w-72 bg-surface-1 p-3">
          <Story />
        </div>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof TicketChildrenSection>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 子なし: Story = {
  decorators: [withApi({ '/workspaces/acme/tickets/t-1/children': { tickets: [] } })],
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(within(canvasElement).getByText('子チケットはありません')).toBeInTheDocument();
    });
  },
};

export const 子あり: Story = {
  decorators: [
    withApi({
      '/workspaces/acme/tickets/t-1/children': { tickets: [childWire({ id: 'c-1', title: '設計する' })] },
    }),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(within(canvasElement).getByText('設計する')).toBeInTheDocument();
    });
  },
};
