import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import TicketAttributePanel from './TicketAttributePanel';
import { withApi } from '../../../../.storybook/decorators';
import type { Ticket, TicketStatus } from '@/entities/ticket';
import type { KbGrantablePrincipal } from '@/entities/kb';

const ticket: Ticket = {
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

const principals: KbGrantablePrincipal[] = [{ id: 'p-1', kind: 'user', name: 'norman6464' }];

function candidateWire(over: Record<string, unknown> & { id: string }) {
  return {
    workspaceId: 'w-1',
    projectId: 's-1',
    number: 3,
    typeId: 'ty-1',
    statusId: 'st-1',
    title: '候補',
    doc: { type: 'doc', content: [] },
    priority: 2,
    storyPoints: null,
    teamId: null,
    position: 'a0',
    createdByUserId: 1,
    createdAt: '',
    updatedAt: '',
    ...over,
  };
}

const meta = {
  title: 'pages/backlog/TicketAttributePanel',
  component: TicketAttributePanel,
  args: {
    ticket,
    workspaceSlug: 'acme',
    projectKey: 'FRESTYLE',
    principals,
    parentTicket: undefined,
    canEdit: true,
    archived: false,
    busy: false,
    priority: ticket.priority,
    storyPoints: ticket.storyPoints,
    startDate: ticket.startDate,
    dueDate: ticket.dueDate,
    versions: [],
    teams: [],
    fixVersions: [],
    sprint: null,
    teamId: null,
    onSetFixVersion: fn(),
    onChangeTeam: fn(),
    allLabels: [],
    onToggleLabel: fn(),
    onCreateLabel: fn(),
    onChangeStoryPoints: fn(),
    onAssign: fn(),
    onUnassign: fn(),
    onChangePriority: fn(),
    onChangeStartDate: fn(),
    onChangeDueDate: fn(),
    onChangeParent: fn(),
  },
  decorators: [(Story) => <div className="w-72 bg-surface-1 p-3"><Story /></div>],
} satisfies Meta<typeof TicketAttributePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 編集できる: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 状態はこの面には無い（題名の直下の TicketStatusSelect が持つ）。
    await expect(canvas.queryByLabelText('状態')).toBeNull();
    await expect(canvas.getByLabelText('担当')).toHaveValue('p-1');
    await expect(canvas.getByLabelText('優先度')).toHaveValue('1');
    // 期限は押すまで文字（見本と同じ）。押してはじめて日付の入力欄になる。
    await expect(canvas.queryByLabelText('期限')).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: '2026-09-12' }));
    await expect(canvas.getByLabelText('期限')).toHaveValue('2026-09-12');
    await expect(canvas.getByLabelText('親を変更')).toHaveTextContent('なし');
  },
};

/**
 * 空の項目は枠を出さず案内文だけを置く（見本と同じ）。入力欄を最初から並べると、
 * まだ何も入っていない項目まで枠だらけになり「読む項目」と区別が付かなくなる。
 */
export const 空の項目は押すまで文字: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const blank = canvas.getByRole('button', { name: '開始日を設定' });
    await expect(canvas.queryByLabelText('開始日')).toBeNull();
    await userEvent.click(blank);
    await expect(canvas.getByLabelText('開始日')).toBeInTheDocument();
  },
};

export const 読むだけ: Story = {
  args: { canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByLabelText('状態')).toBeNull();
    await expect(canvas.queryByLabelText('親を変更')).toBeNull();
    // 「なし」は修正バージョンと親の 2 か所に出るので、件数で見る（どちらも空の状態）。
    await expect(canvas.getAllByText('なし')).toHaveLength(2);
  },
};

export const 親がある: Story = {
  args: {
    ticket: { ...ticket, parentId: 'p-parent' },
    parentTicket: { ...ticket, id: 'p-parent', number: 3, title: '親チケット' },
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText('親を変更')).toHaveTextContent('FRESTYLE-3');
  },
};

export const アーカイブ済みは親を編集できない: Story = {
  args: { archived: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByLabelText('親を変更')).toBeNull();
  },
};

export const ピッカーを開いて候補から選ぶ: Story = {
  decorators: [
    withApi({
      '/workspaces/acme/projects/s-1/tickets': {
        tickets: [candidateWire({ id: 'c-1', number: 3, title: '検索の改善' }), candidateWire({ id: 'c-2', number: 9, title: '絞り込みの見直し' })],
      },
    }),
  ],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('親を変更'));
    await waitFor(async () => {
      await expect(canvas.getByText('検索の改善')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByText('検索の改善'));
    await expect(args.onChangeParent).toHaveBeenCalledWith('c-1');
    // 選ぶとピッカーは閉じる。
    await expect(canvas.queryByLabelText('親を絞り込む')).toBeNull();
  },
};

export const ピッカーで絞り込む: Story = {
  decorators: [
    withApi({
      '/workspaces/acme/projects/s-1/tickets': {
        tickets: [candidateWire({ id: 'c-1', number: 3, title: '検索の改善' }), candidateWire({ id: 'c-2', number: 9, title: '絞り込みの見直し' })],
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('親を変更'));
    await waitFor(async () => {
      await expect(canvas.getByText('検索の改善')).toBeInTheDocument();
    });
    await userEvent.type(canvas.getByLabelText('親を絞り込む'), '絞り込み');
    await expect(canvas.getByText('絞り込みの見直し')).toBeInTheDocument();
    await expect(canvas.queryByText('検索の改善')).toBeNull();
  },
};

export const 親を外す: Story = {
  args: {
    ticket: { ...ticket, parentId: 'p-parent' },
    parentTicket: { ...ticket, id: 'p-parent', number: 3, title: '親チケット' },
  },
  decorators: [withApi({ '/workspaces/acme/projects/s-1/tickets': { tickets: [] } })],
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('親を変更'));
    await waitFor(async () => {
      await expect(canvas.getByText('親を外す（トップレベルへ）')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByText('親を外す（トップレベルへ）'));
    await expect(args.onChangeParent).toHaveBeenCalledWith(null);
  },
};
