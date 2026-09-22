import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import KbBacklogPage from './KbBacklogPage';
import { routerWithParam, withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';

const workspaces = [{ slug: 'acme', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
const projects = [
  { id: 'p-1', workspaceId: 'w-1', key: 'frestyle', name: 'frestyle', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

const status = (over: Record<string, unknown>) => ({
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

const type = (over: Record<string, unknown>) => ({
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

const ticket = (over: Record<string, unknown>) => ({
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  number: 457,
  typeId: 'ty-1',
  statusId: 'st-1',
  title: '段1: チケットの骨格（9表）',
  doc: { type: 'doc', content: [] },
  priority: 1,
  position: 'a0',
  createdByUserId: 1,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
  ...over,
});

function baseApi(over: ApiStubs = {}): ApiStubs {
  return {
    '/workspaces/acme/projects/p-1/ticket-statuses': { statuses: [status({})] },
    '/workspaces/acme/projects/p-1/ticket-types': { types: [type({})] },
    '/workspaces/acme/labels': { labels: [] },
    // 宛先は「先に登録した鍵の部分一致」で決まる。`…/tickets` は `…/tickets/counts` にも一致するので、
    // 長い方を先に置く。
    '/workspaces/acme/projects/p-1/tickets/counts': { total: 1, assignedToMe: 0, overdue: 1, unassigned: 1 },
    '/workspaces/acme/projects/p-1/tickets': { tickets: [ticket({})] },
    '/workspaces/acme/projects': { projects },
    '/kb/workspaces': workspaces,
    ...over,
  };
}

const meta = {
  title: 'pages/backlog/KbBacklogPage',
  component: KbBacklogPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast, routerWithParam('/backlog/:projectId', '/backlog/p-1')],
} satisfies Meta<typeof KbBacklogPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ふつう: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    });
  },
};

export const 狭い画面: Story = {
  decorators: [withApi(baseApi())],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

export const アーカイブが空: Story = {
  decorators: [withApi(baseApi({ '/workspaces/acme/projects/p-1/tickets': { tickets: [] } }))],
  args: { view: 'archive' },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('heading', { name: 'アーカイブされたチケットはありません' })).toBeVisible();
  },
};

export const 設定の取得失敗を未有効化と取り違えない: Story = {
  decorators: [withApi(baseApi({ '/workspaces/acme/projects/p-1/ticket-statuses': () => { throw new Error('offline'); } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'チケットの設定を読み込めませんでした' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '再読み込み' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'チケットを有効化' })).toBeNull();
  },
};

export const 未有効化: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/projects/p-1/ticket-statuses': { statuses: [] },
        '/workspaces/acme/projects/p-1/ticket-types': { types: [] },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(
        within(canvasElement).getByText('このプロジェクトではチケットを使っていません'),
      ).toBeInTheDocument();
    });
  },
};

/**
 * 面の切替は本文のタブ列が持ち、1 つずつが固有の経路を持つ（見本と同じ）。
 * リンクなので中クリックで別タブにも開ける。
 */
export const 面のタブは経路を持つ: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    });
    const settings = canvas.getByRole('link', { name: '設定' });
    await expect(settings).toHaveAttribute('href', '/backlog/p-1/settings');
    await expect(canvas.getByRole('link', { name: 'アーカイブ' })).toHaveAttribute(
      'href',
      '/backlog/p-1/archive',
    );
    // いま見ている面が分かる。
    await expect(canvas.getByRole('link', { name: 'バックログ' })).toHaveAttribute('aria-current', 'page');
  },
};

/** 見出しの塊。プロジェクトの行 → 面の名前 → 一文 → 保存した絞り込みのタブ → 操作列（設計ボード ST08）。 */
export const 見出しと絞り込みタブ: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { level: 1, name: 'バックログ' })).toBeInTheDocument();
    });
    await expect(canvas.getByText('プロジェクト FRESTYLE')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: /期限切れ/ })).toHaveTextContent('1');
    });
    // 課題をつくる は操作列に。見出しの塊には無い。
    await expect(canvas.getByRole('button', { name: '課題をつくる' })).toBeInTheDocument();
  },
};

/** 「フィルター」を押すと選択欄が現れ、条件を選ぶと URL とチップに載る。 */
export const フィルターを開いて条件を付ける: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole('button', { name: 'フィルター' }));
    await userEvent.click(canvas.getByLabelText('状態で絞り込む'));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'To Do' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: '状態: To Do の絞り込みを解除' })).toBeVisible();
    });
    await expect(canvas.getByLabelText('1 件の条件を適用中')).toBeInTheDocument();
  },
};

/** 設定の面。状態・種別・スプリントの管理をここに集める。 */
export const 設定の面: Story = {
  // 面は経路ではなく prop で決まる（経路 → prop の対応は app/App.tsx が持つ）。
  // ここで router を重ねると入れ子になるので、meta の router のまま prop だけ変える。
  decorators: [withApi(baseApi())],
  render: () => <KbBacklogPage view="settings" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      // 状態と種別の管理はどちらも色を選ぶ口を持つので、件数で見る（一覧には 1 つも無い）。
      await expect(canvas.getAllByLabelText('色')).toHaveLength(2);
    });
    // スプリントの改名・期間・削除もこの面。バックログの面には置かない。
    await expect(canvas.getByRole('button', { name: 'スプリントを作成' })).toBeInTheDocument();
  },
};
