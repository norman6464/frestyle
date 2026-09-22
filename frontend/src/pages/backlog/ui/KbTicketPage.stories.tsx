import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import KbTicketPage from './KbTicketPage';
import { routerWithParam, withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';

const status = (over: Record<string, unknown> = {}) => ({
  id: 'st-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  name: 'To Do',
  category: 'todo',
  color: '#5b6b7a',
  position: 'a0',
  isInitial: true,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  activeTicketCount: 1,
  ...over,
});

const type = (over: Record<string, unknown> = {}) => ({
  id: 'ty-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  name: '開発タスク',
  hierarchyLevel: 0,
  color: '#2563eb',
  position: 'a0',
  isDefault: true,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  activeTicketCount: 1,
  ...over,
});

const permission = { canView: true, canComment: true, canEdit: true, canManage: false };

// backend の ticketResponse（ancestors・permission も含めてチケット 1 件の中に平らに入る）と
// 同じ形。トップレベルに置くとバグる（実際に踏んだ — 祖先の story が空を返して落ちた）。
const ticket = (over: Record<string, unknown> = {}) => ({
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  number: 102,
  typeId: 'ty-1',
  statusId: 'st-1',
  title: '検索の絞り込みが日本語で効かない',
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '再現手順を書く。' }] }] },
  priority: 1,
  position: 'a0',
  createdByUserId: 1,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
  labels: [{ id: 'l-1', projectId: 'p-1', name: '不具合', color: '#1d4ed8', createdAt: '', updatedAt: '' }],
  ancestors: [],
  permission,
  ...over,
});

const projects = [
  { id: 'p-1', workspaceId: 'w-1', key: 'frestyle', name: 'frestyle', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

function resolvedResponse(ticketOver: Record<string, unknown> = {}, canEdit = true) {
  return {
    workspaceSlug: 'acme',
    workspaceName: 'Acme',
    ticket: ticket(ticketOver),
    canEdit,
  };
}

// withApi は URL の部分一致で当たる（method は見ない）。より具体的なパスを、
// それを含む一般的なパスより先に置く。
//
// とくに表示キーからの解決（'/tickets/t-1'）は最後に置くこと。この文字列は
// '/workspaces/acme/tickets/t-1/history' などにも含まれるので、先に置くと履歴・発言・
// 添付・子の宛先を全部飲み込み、どれも解決の応答（groups を持たない）が返る。
function baseApi(over: ApiStubs = {}): ApiStubs {
  return {
    '/workspaces/acme/tickets/t-1/history': { groups: [] },
    '/workspaces/acme/tickets/t-1/comments': { comments: [] },
    '/workspaces/acme/tickets/t-1/attachments': { attachments: [] },
    '/workspaces/acme/tickets/t-1/children': { tickets: [] },
    '/profile/me': { userId: 1, displayName: 'norman6464', email: '', bio: '', avatarUrl: '', status: '', updatedAt: '' },
    '/workspaces/acme/projects/p-1/ticket-statuses': { statuses: [status()] },
    '/workspaces/acme/projects/p-1/ticket-types': { types: [type()] },
    '/workspaces/acme/labels': {
      labels: [{ id: 'l-1', name: '不具合', color: '#1d4ed8', createdAt: '', updatedAt: '' }],
    },
    // useTicketPage は表示キー（FRESTYLE-102）のために projects.key を単体で引く。
    // 一覧の宛先より先に置く（前方一致だと一覧の形（{projects: [...]}）が返ってしまい、
    // key が取れずキーが「-102」になる）。
    '/workspaces/acme/projects/p-1': projects[0],
    '/workspaces/acme/projects': { projects },
    // 上のどれよりも広く当たるので最後（先頭のコメント参照）。
    '/tickets/t-1': resolvedResponse(),
    ...over,
  };
}

const meta = {
  title: 'pages/backlog/KbTicketPage',
  component: KbTicketPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast, routerWithParam('/tickets/:ticketId', '/tickets/t-1')],
} satisfies Meta<typeof KbTicketPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ふつう: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-102')).toBeInTheDocument();
    });
    await expect(canvas.getByLabelText('題名')).toHaveValue(ticket().title as string);
    await userEvent.click(canvas.getByRole('button', { name: '計画と整理' }));
    await expect(canvas.getByText('不具合')).toBeInTheDocument();
  },
};

export const 祖先あり: Story = {
  decorators: [
    withApi(
      baseApi({
        '/tickets/t-1': resolvedResponse({
          ancestors: [
            ticket({ id: 't-root', number: 3, title: '検索まわりの改善' }),
            ticket({ id: 't-mid', number: 9, title: '絞り込みの見直し' }),
          ],
        }),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('navigation', { name: '親チケット' })).toBeInTheDocument();
    });
    // 直近の親は素性欄の「親」にも同じキーで出る（別の場所・別の役割）ので、
    // パンくずの領域に絞って確かめる。
    const trail = within(canvas.getByRole('navigation', { name: '親チケット' }));
    await expect(trail.getByText('FRESTYLE-3')).toBeInTheDocument();
    await expect(trail.getByText('FRESTYLE-9')).toBeInTheDocument();
  },
};

export const 読むだけ: Story = {
  decorators: [
    withApi(
      baseApi({
        '/tickets/t-1': resolvedResponse({ permission: { ...permission, canEdit: false } }, false),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText(ticket().title as string)).toBeInTheDocument();
    });
    await expect(canvas.queryByLabelText('題名')).toBeNull();
    await expect(canvas.queryByLabelText('状態')).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'アーカイブ' })).toBeNull();
  },
};

export const アーカイブ済み: Story = {
  decorators: [
    withApi(
      baseApi({
        '/tickets/t-1': resolvedResponse({ archivedAt: '2026-09-10T00:00:00Z' }),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('このチケットはアーカイブされています')).toBeInTheDocument();
    });
    await expect(canvas.getByRole('button', { name: '現役に戻す' })).toBeInTheDocument();
  },
};

export const 見つからない: Story = {
  decorators: [
    withApi({
      '/tickets/t-1': () => {
        const err = new Error('not found') as Error & { isAxiosError: boolean; response: unknown };
        err.isAxiosError = true;
        err.response = { status: 404, data: { error: 'not_found' } };
        throw err;
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(within(canvasElement).getByText('チケットが見つかりませんでした。')).toBeInTheDocument();
    });
  },
};

export const 変更履歴あり: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/tickets/t-1/history': {
          groups: [
            {
              id: 'g-1',
              workspaceId: 'w-1',
              ticketId: 't-1',
              actorUserId: 1,
              createdAt: '2026-09-09T15:20:00Z',
              items: [
                { id: 'i-1', groupId: 'g-1', field: 'status', oldValue: 'st-1', newValue: 'st-2', oldLabel: 'To Do', newLabel: '開発' },
              ],
            },
          ],
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-102')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole('button', { name: '変更履歴' }));
    const item = await canvas.findByRole('listitem');
    await expect(item).toHaveTextContent('状態を');
  },
};
