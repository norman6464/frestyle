import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import BacklogList, { BACKLOG_GROUP_ID, type BacklogGroupModel } from './BacklogList';
import type { Ticket, TicketStatus, TicketType } from '@/entities/ticket';

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
    activeTicketCount: 1,
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
    activeTicketCount: 1,
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
    activeTicketCount: 2,
  },
];

function ticket(over: Partial<Ticket>): Ticket {
  return {
    id: 't-1',
    workspaceId: 'w-1',
    projectId: 's-1',
    number: 457,
    typeId: 'ty-1',
    statusId: 'st-2',
    parentId: null,
    title: '段1: チケットの骨格',
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
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-09T00:00:00Z',
    assigneePrincipalId: null,
    labels: [],
    ...over,
  };
}

const tickets: Ticket[] = [
  ticket({ id: 't-1', number: 457 }),
  ticket({ id: 't-2', number: 458, statusId: 'st-1', parentId: 't-1' }),
];

/** 段が 1 つだけ（スプリントが無いプロジェクト）の形。 */
function backlogOnly(rows: Ticket[]): BacklogGroupModel[] {
  return [{ id: BACKLOG_GROUP_ID, kind: 'backlog', name: 'バックログ', tickets: rows }];
}

const meta = {
  title: 'pages/backlog/BacklogList',
  component: BacklogList,
  parameters: { layout: 'fullscreen' },
  args: {
    groups: backlogOnly(tickets),
    statuses,
    types,
    projectKey: 'FRESTYLE',
    loading: false,
    error: null,
    archived: false,
    canEdit: true,
    selectedId: null,
    busyId: null,
    nameOf: () => '',
    initialsOf: () => '',
    onSelect: fn(),
    onCreate: fn(async () => {}),
    onChangeStatus: fn(),
    onMove: fn(async () => {}),
    onRetry: fn(),
  },
  decorators: [
    (Story) => (
      <div className="h-[520px] w-[640px] bg-surface-1">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BacklogList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ふつう: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    await expect(canvas.getByText('FRESTYLE-458')).toBeInTheDocument();
  },
};

export const 空: Story = {
  args: { groups: backlogOnly([]) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('まだチケットがありません')).toBeInTheDocument();
  },
};

export const 読み取りだけ: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    // 作成行・並び替えの帯が出ない。
    await expect(within(canvasElement).queryByLabelText('新しいチケットの題名')).toBeNull();
  },
};

export const アーカイブ: Story = {
  args: {
    archived: true,
    groups: backlogOnly([ticket({ id: 't-3', number: 402, archivedAt: '2026-09-01T00:00:00Z' })]),
  },
};

export const 絞り込みで0件: Story = {
  args: { groups: backlogOnly([]), filtered: true },
};

/**
 * スプリントは別の面にせず、バックログの上に段として積む（見本と同じ）。
 * 1 件のチケットはどちらか一方の段にしか出ない。
 */
export const スプリントの段: Story = {
  args: {
    groups: [
      {
        id: 'sp-1',
        kind: 'sprint',
        name: 'スプリント 1',
        sprintState: 'active',
        note: '2026-09-01 – 2026-09-14',
        tickets: [ticket({ id: 't-9', number: 401, title: '進行中の作業' })],
      },
      ...backlogOnly(tickets),
    ],
    onMoveInSprint: fn(async () => {}),
    onMoveToSprint: fn(),
    onRemoveFromSprint: fn(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('スプリント 1')).toBeInTheDocument();
    await expect(canvas.getByText('バックログ')).toBeInTheDocument();
    // 件数は段ごと。合計ではない。
    await expect(canvas.getByText('（1 件の作業項目）')).toBeInTheDocument();
    await expect(canvas.getByText('（2 件の作業項目）')).toBeInTheDocument();
  },
};

/** 段は畳める。畳むと中の行が消える（見出しと件数は残る）。 */
export const 段を畳む: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /バックログ/ }));
    await waitFor(async () => {
      await expect(canvas.queryByText('FRESTYLE-457')).toBeNull();
    });
    await expect(canvas.getByText('（2 件の作業項目）')).toBeInTheDocument();
  },
};

export const 読み込み失敗: Story = {
  args: { error: 'チケットを読み込めませんでした。', groups: backlogOnly([]) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
  },
};
