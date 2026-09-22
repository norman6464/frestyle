import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withApi, withRouter } from '../../../../.storybook/decorators';
import MenuPage from './MenuPage';

/**
 * ログインしたあと最初に出るホーム。
 *
 * 未完了の担当を主役に、最近見たページと作業の入口をまとめる。
 * 担当と閲覧履歴は独立して読み込み、一方の障害で他方を隠さない。
 */
const meta = {
  title: 'pages/home/MenuPage',
  component: MenuPage,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRouter,
    withApi({
      '/kb/workspaces': [{ id: 'w1', slug: 'team-a', name: '開発チーム' }],
      '/workspaces/team-a/tickets/assigned': { tickets: [
        { id: 't1', projectId: 'p1', projectKey: 'APP', projectName: 'FreStyle', number: 24, title: '初めての人が迷わず参加できる導線にする', typeName: '改善', statusName: '進行中', statusCategory: 'in_progress', statusColor: '#2563eb', priority: 1, dueDate: null },
        { id: 't2', projectId: 'p1', projectKey: 'APP', projectName: 'FreStyle', number: 25, title: 'チームで使うナレッジの目次を整理する', typeName: 'タスク', statusName: '未着手', statusCategory: 'todo', statusColor: '#66655f', priority: 2, dueDate: null },
        { id: 't3', projectId: 'p2', projectKey: 'WEB', projectName: 'Webサイト', number: 8, title: 'リリース前の動作確認', typeName: 'タスク', statusName: 'レビュー中', statusCategory: 'in_progress', statusColor: '#2563eb', priority: 2, dueDate: null },
      ] },
      '/kb/me/recent-pages': [
        { pageId: 'page-1', workspaceSlug: 'team-a', title: 'リリース手順', spaceId: 's1', spaceName: '開発ノート', viewedAt: '2026-09-20T09:00:00.000Z' },
        { pageId: 'page-2', workspaceSlug: 'team-a', title: '今週の設計メモ', spaceId: 's1', spaceName: '開発ノート', viewedAt: '2026-09-19T09:00:00.000Z' },
        { pageId: 'page-3', workspaceSlug: 'personal', title: '検討中のアイデア', spaceId: 's2', spaceName: '個人メモ', viewedAt: '2026-09-18T09:00:00.000Z' },
      ],
    }),
    (Story) => (
      <div className="bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MenuPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 既定。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('heading', { name: 'ホーム' }),
    ).toBeVisible();
  },
};

/** 狭い画面。続きと次の行動が縦に並ぶ。 */
export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
