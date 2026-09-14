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
