import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import BacklogRow from './BacklogRow';
import type { Ticket, TicketStatus, TicketType } from '@/entities/ticket';

const baseTicket: Ticket = {
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 's-1',
  number: 457,
  typeId: 'ty-1',
  statusId: 'st-2',
  parentId: null,
  title: '段1: チケットの骨格（9表）',
  doc: { type: 'doc', content: [] },
  priority: 1,
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
};

const devType: TicketType = {
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
};

const devStatus: TicketStatus = {
  id: 'st-2',
  workspaceId: 'w-1',
  projectId: 's-1',
  name: '開発',
  category: 'in_progress',
  color: '#a0661a',
  position: 'a0',
  isInitial: false,
  archivedAt: null,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  activeTicketCount: 2,
};

const doneStatus: TicketStatus = { ...devStatus, id: 'st-5', name: 'リリース', category: 'done', color: '#2f6b47' };

const allStatuses: TicketStatus[] = [
  { ...devStatus, id: 'st-1', name: 'To Do', category: 'todo', color: '#5b6b7a' },
  devStatus,
  doneStatus,
];

const meta = {
  title: 'pages/backlog/BacklogRow',
  component: BacklogRow,
  parameters: { layout: 'padded' },
  args: {
    ticket: baseTicket,
    projectKey: 'FRESTYLE',
    type: devType,
    status: devStatus,
    statuses: allStatuses,
    assigneeName: '',
    assigneeInitials: '',
    selected: false,
    busy: false,
    canEdit: true,
    indented: false,
    onOpen: fn(),
    onChangeStatus: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-[560px] border border-surface-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BacklogRow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 担当あり: Story = {
  args: {
    ticket: { ...baseTicket, assigneePrincipalId: 'p-nor' },
    assigneeName: 'norman6464',
    assigneeInitials: 'NO',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    await expect(canvas.getByText('NO')).toBeInTheDocument();
  },
};

export const 未割り当て: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('未割り当て')).toBeInTheDocument();
  },
};

export const 子チケット_字下げ: Story = {
  args: { ticket: { ...baseTicket, parentId: 't-0' }, indented: true },
};

/**
 * 期限とラベルは行に出さない（見本と同じ）。持っていても行は変わらず、詳細パネルで読む。
 * 1 行に収めるために落とした列で、値そのものを捨てたわけではない。
 */
export const 期限とラベルは行に出さない: Story = {
  args: {
    ticket: {
      ...baseTicket,
      dueDate: '2020-01-01',
      labels: [{ id: 'l-1', name: '不具合', color: '#1d4ed8', createdAt: '', updatedAt: '' }],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText('01/01')).toBeNull();
    await expect(canvas.queryByText('不具合')).toBeNull();
  },
};

export const 完了枠_打ち消し線: Story = {
  args: { status: doneStatus },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText(baseTicket.title)).toHaveClass('line-through');
  },
};

export const 操作中: Story = {
  args: { busy: true },
};

/**
 * 優先度は印だけを出す（▲ 高 / − 中 / ▼ 低）。文字は読み上げにだけ残す —— 見本も行には
 * 印しか置かない。状態は行の中で変えられる（見本と同じ）。
 */
export const 優先度と状態の見え方: Story = {
  args: { ticket: { ...baseTicket, priority: 1, storyPoints: 5 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('▲')).toBeInTheDocument();
    await expect(canvas.getByText('優先度: 高')).toBeInTheDocument();
    await expect(canvas.getByText('見積り 5')).toBeInTheDocument();
    // 状態は選べる（押せるのに変わらない見た目にはしない）。
    const status = canvas.getByLabelText(`${baseTicket.title} の状態`);
    await expect(status).toHaveValue('st-2');
  },
};

/** 行を押すと開く。状態を変えても開かない —— 別々の操作として分かれている。 */
export const 状態を変えても行は開かない: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.selectOptions(canvas.getByLabelText(`${baseTicket.title} の状態`), 'st-5');
    await expect(args.onChangeStatus).toHaveBeenCalledWith('st-5');
    await expect(args.onOpen).not.toHaveBeenCalled();
  },
};

/** 種別は行の先頭に色付きの角丸で出る（見本と同じ）。名前は読み上げに残す。 */
export const 種別は先頭の印: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('種別: 開発タスク')).toBeInTheDocument();
  },
};

/** 見積りは未設定（—）と 0 を区別する。0 は「やることが無い」で、未設定とは別物。 */
export const 見積りは未設定と0を区別する: Story = {
  args: { ticket: { ...baseTicket, storyPoints: 0 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('見積り 0')).toBeInTheDocument();
  },
};
