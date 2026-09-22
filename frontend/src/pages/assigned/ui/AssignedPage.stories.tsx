import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import type { AssignedTicket } from '@/entities/ticket';
import { withApi, withRouter } from '../../../../.storybook/decorators';
import { localToday } from '../lib/dueDate';
import AssignedPage from './AssignedPage';

const meta = {
  title: 'pages/assigned/AssignedPage',
  component: AssignedPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withRouter, (Story) => <div className="min-h-screen bg-surface"><Story /></div>],
} satisfies Meta<typeof AssignedPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const today = new Date();
const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
const ticket = (id: number, overrides: Partial<AssignedTicket> = {}): AssignedTicket => ({
  id: `ticket-${id}`, projectId: 'project-1', projectKey: 'APP', projectName: 'アプリ開発',
  number: id, title: 'ログイン後の画面遷移を確認する', typeName: 'タスク',
  statusName: '進行中', statusCategory: 'in_progress', statusColor: '#d4c5a0',
  priority: 1, dueDate: localToday(today), ...overrides,
});

const tickets = [
  ticket(12, { dueDate: localToday(yesterday) }),
  ticket(13, { title: 'チームに設計案を共有する', priority: 2 }),
  ticket(24, { title: 'スマートフォンでの表示を確認する', projectKey: 'WEB', projectName: 'チームサイト', priority: 2, dueDate: localToday(tomorrow) }),
  ticket(25, { title: '次のリリースに向けた作業を整理する', statusName: '未着手', statusCategory: 'todo', dueDate: null, priority: 0 }),
];
const api = (items: AssignedTicket[]) => withApi({
  '/kb/workspaces': [{ id: 'workspace-1', slug: 'team', name: '開発チーム' }],
  '/tickets/assigned': { tickets: items },
});

export const 既定: Story = {
  decorators: [api(tickets)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: /ログイン後の画面遷移を確認する/ })).toBeVisible();
    await expect(canvas.getByRole('region', { name: '担当の概要' })).toBeVisible();
  },
};

export const 狭い画面: Story = {
  decorators: [api(tickets)],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

export const 長いタイトル: Story = {
  decorators: [api([ticket(12, {
    title: '次回リリースまでにログインからプロジェクトの作成までの一連の操作をスマートフォンとキーボードで確認する',
    projectName: 'https://example.com/projects/abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz',
    statusName: 'チームメンバーのレビューを待っています',
  })])],
};

export const 空: Story = { decorators: [api([])] };
export const 取得に失敗: Story = { decorators: [withApi({})] };
