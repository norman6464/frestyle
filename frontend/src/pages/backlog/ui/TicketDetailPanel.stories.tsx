import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import TicketDetailPanel from './TicketDetailPanel';
import type { Ticket, TicketStatus, TicketType } from '@/entities/ticket';
import type { KbGrantablePrincipal } from '@/entities/kb';
import { withApi, withToast } from '../../../../.storybook/decorators';

const ticket: Ticket = {
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 's-1',
  number: 457,
  typeId: 'ty-1',
  statusId: 'st-2',
  parentId: null,
  title: '段1: チケットの骨格（9表）',
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '本文です。' }] }] },
  priority: 1,
  storyPoints: null,
  teamId: null,
  startDate: null,
  dueDate: '2026-09-12',
  position: 'a0',
  closedAt: null,
  resolution: null,
  createdByUserId: 1,
  archivedAt: null,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
  assigneePrincipalId: 'p-1',
  labels: [],
};

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
    createdAt: '',
    updatedAt: '',
    activeTicketCount: 0,
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
    createdAt: '',
    updatedAt: '',
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
    createdAt: '',
    updatedAt: '',
    activeTicketCount: 1,
  },
];

const principals: KbGrantablePrincipal[] = [{ id: 'p-1', kind: 'user', name: 'norman6464' }];

const meta = {
  title: 'pages/backlog/TicketDetailPanel',
  component: TicketDetailPanel,
  parameters: { layout: 'fullscreen' },
  args: {
    ticket,
    projectKey: 'FRESTYLE',
    statuses,
    types,
    principals,
    parentTicket: undefined,
    canEdit: true,
    busy: false,
    onUpdate: fn(async (_id, _input) => ticket),
    onChangeStatus: fn(async () => {}),
    onAssign: fn(async () => {}),
    onUnassign: fn(async () => {}),
    onArchive: fn(async () => {}),
    onRestore: fn(async () => {}),
    workspaceSlug: 'acme',
    allLabels: [
      { id: 'l-1', name: '不具合', color: '#1d4ed8', createdAt: '', updatedAt: '' },
      { id: 'l-2', name: '要調査', color: '#8b7355', createdAt: '', updatedAt: '' },
    ],
    onToggleLabel: fn(),
    onCreateLabel: fn(async (name, color) => ({ id: 'l-new', projectId: 's-1', name, color, createdAt: '', updatedAt: '' })),
    onChangeParent: fn(async () => {}),
  },
  decorators: [
    withToast,
    (Story) => (
      <div className="h-[640px] w-[360px] border-l border-surface-3 bg-surface-1">
        <Story />
      </div>
    ),
    // TicketCommentSection（コメント節）が自分の userId とコメント一覧を、
    // TicketAttachmentSection（添付節）が添付一覧を、TicketChildrenSection（子節）が
    // 子一覧を取得する。どの story にも共通で要る宛先なので meta 側の decorator に置く。
    withApi({
      '/profile/me': { userId: 1, displayName: 'norman6464', email: '', bio: '', avatarUrl: '', status: '', updatedAt: '' },
      '/workspaces/acme/tickets/t-1/comments': { comments: [] },
      '/workspaces/acme/tickets/t-1/attachments': { attachments: [] },
      '/workspaces/acme/tickets/t-1/children': { tickets: [] },
    }),
  ],
} satisfies Meta<typeof TicketDetailPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 編集できる: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    await expect(canvas.getByLabelText('題名')).toHaveValue(ticket.title);
  },
};

export const 読むだけ: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText('状態')).toBeNull();
    await expect(canvas.getByText(ticket.title)).toBeInTheDocument();
  },
};

export const 状態変更が失敗しても表示は元のまま: Story = {
  args: { onChangeStatus: fn(async () => Promise.reject(new Error('409'))) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const select = canvas.getByLabelText('状態') as HTMLSelectElement;
    await userEvent.selectOptions(select, 'st-1');
    await waitFor(() => expect(args.onChangeStatus).toHaveBeenCalledWith('st-1'));
    // ticket prop 自体は変わっていないので、表示は選択中チケットの statusId のまま。
    await expect(select).toHaveValue('st-2');
  },
};

export const ラベルつき: Story = {
  args: {
    ticket: {
      ...ticket,
      labels: [
        { id: 'l-1', name: '不具合', color: '#1d4ed8', createdAt: '', updatedAt: '' },
        { id: 'l-2', name: '要調査', color: '#8b7355', createdAt: '', updatedAt: '' },
      ],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('不具合')).toBeInTheDocument();
    await expect(canvas.getByText('要調査')).toBeInTheDocument();
  },
};

// パネルの見出し（「チケット」）と閉じるボタンは器（SecondaryPanel）が描く。
// ここで同じものを出すと二重になる。
//
// 「詳細」は節の見出しとして中にある（属性の一覧）ので、無いことを確かめる対象ではない。
export const 見出しを自分では描かない: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('チケット')).toBeNull();
    await expect(canvas.queryByRole('button', { name: '詳細を閉じる' })).toBeNull();
  },
};
