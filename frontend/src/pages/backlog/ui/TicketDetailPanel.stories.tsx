import { AxiosError, type AxiosResponse, type InternalAxiosRequestConfig } from 'axios';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import TicketDetailPanel from './TicketDetailPanel';
import type { Ticket, TicketStatus, TicketType } from '@/entities/ticket';
import type { KbGrantablePrincipal } from '@/entities/kb';
import { withApi, withRouter, withToast } from '../../../../.storybook/decorators';

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
    onToggleLabel: fn(async () => {}),
    onCreateLabel: fn(async (name, color) => ({ id: 'l-new', projectId: 's-1', name, color, createdAt: '', updatedAt: '' })),
    onChangeParent: fn(async () => {}),
  },
  decorators: [
    withToast,
    // 身元（キー・種別）は全画面へのリンクなので router が要る。
    withRouter,
    (Story) => (
      <div className="h-[640px] w-[420px] border-l border-surface-3 bg-surface-1">
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

/** サーバーの応答を持った失敗（断られた）。code は backend の機械可読コード。 */
function rejected(status: number, code?: string): AxiosError {
  const config = {} as InternalAxiosRequestConfig;
  return new AxiosError('rejected', 'ERR_BAD_REQUEST', config, undefined, {
    status,
    data: code ? { error: code } : {},
    statusText: '',
    headers: {},
    config,
  } as AxiosResponse);
}

/** 応答の無い失敗（通信の切断）。変わったかどうか分からない。 */
function networkFailure(): AxiosError {
  return new AxiosError('Network Error', 'ERR_NETWORK', {} as InternalAxiosRequestConfig);
}

async function chooseStatus(canvasElement: HTMLElement, name: string) {
  const select = within(canvasElement).getByRole('combobox', { name: '状態' });
  if (select.getAttribute('aria-expanded') !== 'true') await userEvent.click(select);
  await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name }));
  return select;
}

/** 状態を変えた結果は選択欄のすぐ下に出す（設計ボード PX04）。成功は応答を受け取ってから。 */
export const 状態を変えた結果をその場に出す: Story = {
  play: async ({ args, canvasElement }) => {
    await chooseStatus(canvasElement, 'To Do');
    await waitFor(() => expect(args.onChangeStatus).toHaveBeenCalledWith('st-1'));
    await expect(await within(canvasElement).findByText('状態を「To Do」にしました')).toBeVisible();
  },
};

/** 断られたら理由を出し、表示は変更前のまま（楽観更新をしない）。 */
export const 状態の変更を断られたら理由を出す: Story = {
  args: { onChangeStatus: fn(async () => Promise.reject(rejected(404, 'status_not_found'))) },
  play: async ({ args, canvasElement }) => {
    const select = await chooseStatus(canvasElement, 'To Do');
    await waitFor(() => expect(args.onChangeStatus).toHaveBeenCalledWith('st-1'));
    await expect(await within(canvasElement).findByText('この状態は今は選べません。選択肢を更新してください。')).toBeVisible();
    await expect(select).toHaveTextContent('開発');
  },
};

/**
 * 通信が切れたら「変更されていません」とは言い切らない。結果がまだ分からないと伝え、
 * 自動で送り直さず、「最新を確認」で取り直させる。
 */
export const 結果が分からなければ最新を確認させる: Story = {
  args: { onChangeStatus: fn(async () => Promise.reject(networkFailure())), onRefresh: fn() },
  play: async ({ args, canvasElement }) => {
    await chooseStatus(canvasElement, 'To Do');
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('通信が途切れました。変更の結果はまだ確認できていません。')).toBeVisible();
    await expect(args.onChangeStatus).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: '最新を確認' }));
    await expect(args.onRefresh).toHaveBeenCalledTimes(1);
  },
};

/** 即時保存の項目（優先度）が断られたら、その項目の下に理由を出し、見た目を元の値へ戻す。 */
export const 優先度の保存に失敗したら元に戻す: Story = {
  args: { onUpdate: fn(async (_id, _input) => Promise.reject(rejected(400))) },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByLabelText('優先度'));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: '低' }));
    await waitFor(() => expect(args.onUpdate).toHaveBeenCalled());
    await expect(await canvas.findByText('保存できませんでした。元の値に戻しました。')).toBeVisible();
    await waitFor(async () => {
      await expect(canvas.getByLabelText('優先度')).toHaveTextContent('高');
    });
    // 戻したので「未保存」は残さない。
    await expect(canvas.getByRole('status', { name: '保存状態' })).not.toHaveTextContent('未保存');
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

// パネルの見出し（「選択中 KEY」）と選択解除は器（TicketDetailPane の帯・TicketDetailSheet）が描く。
// ここで同じものを出すと二重になる。
//
// 「詳細」は節の見出しとして中にある（属性の一覧）ので、無いことを確かめる対象ではない。
export const 見出しを自分では描かない: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText(/^選択中/)).toBeNull();
    await expect(canvas.queryByRole('button', { name: '選択解除' })).toBeNull();
  },
};

/** 身元の行は全画面への入口。キーと種別を 1 行に置く（設計ボード ST11）。 */
export const 身元から全画面へ: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const link = canvas.getByRole('link', { name: /FRESTYLE-457/ });
    await expect(link).toHaveAttribute('href', '/tickets/t-1');
    await expect(link).toHaveTextContent('開発タスク');
  },
};

/** 基本の 4 項目は最初から見え、その他 7 項目は畳まれている。 */
export const 基本とその他に分かれる: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('担当者')).toBeVisible();
    await expect(canvas.getByText('優先度')).toBeVisible();
    await expect(canvas.getByText('期限')).toBeVisible();
    await expect(canvas.getByText('ラベル')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /その他 7 項目/ })).toHaveAttribute('aria-expanded', 'false');
    await expect(canvas.getByText('報告者')).not.toBeVisible();
  },
};
