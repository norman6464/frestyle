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
    selected: false,
    busy: false,
    canEdit: true,
    indented: false,
    // 期限超過の判定に使う「今日」。story は日付に依存しないよう固定する。
    today: '2026-09-22',
    onOpen: fn(),
    onChangeStatus: fn(),
  },
  decorators: [
    (Story) => (
      <div role="table" className="w-[860px] border border-surface-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof BacklogRow>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 担当は名前で出す（表の列なので、頭文字の丸より名前の方が横に並べて読める）。 */
export const 担当あり: Story = {
  args: {
    ticket: { ...baseTicket, assigneePrincipalId: 'p-nor' },
    assigneeName: 'norman6464',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    // 広い画面の列と、狭い画面の補足行の両方に名前がある（表示されるのは片方）。
    await expect(canvas.getAllByText('norman6464').length).toBeGreaterThan(0);
  },
};

export const 未割り当て: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('未割当').length).toBeGreaterThan(0);
  },
};

export const 子チケット_字下げ: Story = {
  args: { ticket: { ...baseTicket, parentId: 't-0' }, indented: true },
};

/**
 * 期限は列に出す（設計ボード ST08）。ラベルは行に出さない —— 持っていても行は変わらず、
 * 詳細パネルで読む。1 行に収めるために落とした列で、値そのものを捨てたわけではない。
 */
export const 期限は列に出しラベルは出さない: Story = {
  args: {
    ticket: {
      ...baseTicket,
      dueDate: '2026-10-04',
      labels: [{ id: 'l-1', name: '不具合', color: '#1d4ed8', createdAt: '', updatedAt: '' }],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText('10/4').length).toBeGreaterThan(0);
    await expect(canvas.queryByText('不具合')).toBeNull();
  },
};

/** 期限を過ぎていて未完了なら、日付を赤く太くし、読み上げには「期限超過」を添える。 */
export const 期限超過: Story = {
  args: { ticket: { ...baseTicket, dueDate: '2026-09-21' } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [due] = canvas.getAllByText('9/21');
    await expect(due).toHaveClass('text-danger-ink');
    await expect(canvas.getAllByText('（期限超過）').length).toBeGreaterThan(0);
  },
};

/** 完了しているものは、期限が過ぎていても超過とは言わない。 */
export const 完了なら期限超過にしない: Story = {
  args: { ticket: { ...baseTicket, dueDate: '2026-09-21' }, status: doneStatus },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const [due] = canvas.getAllByText('9/21');
    await expect(due).not.toHaveClass('text-danger-ink');
    await expect(canvas.queryByText('（期限超過）')).toBeNull();
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
 * 優先度は印と文字で出す（▲ 高 / − 中 / ▼ 低）。列の見出しが「優先度」なので、升の中では
 * 項目名を繰り返さない。状態は行の中で変えられる（設計ボードと同じ）。
 */
export const 優先度と状態の見え方: Story = {
  args: { ticket: { ...baseTicket, priority: 1 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText('▲').length).toBeGreaterThan(0);
    await expect(canvas.getAllByText('高').length).toBeGreaterThan(0);
    // 状態は選べる（押せるのに変わらない見た目にはしない）。
    const status = canvas.getByLabelText(`${baseTicket.title} の状態`);
    await expect(status).toHaveAccessibleName(`${baseTicket.title} の状態`);
    await expect(status).toHaveTextContent('開発');
  },
};

/** 行を押すと開く。状態を変えても開かない —— 別々の操作として分かれている。 */
export const 状態を変えても行は開かない: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    // 候補は別の器（ポータル）へ描かれるので、探す場所が canvas ではなく document になる。
    await userEvent.click(canvas.getByLabelText(`${baseTicket.title} の状態`));
    await userEvent.click(await within(document.body).findByRole('option', { name: 'リリース' }));
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
