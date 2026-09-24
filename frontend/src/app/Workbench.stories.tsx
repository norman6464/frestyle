import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, within } from 'storybook/test';
import { MenuPage } from '@/pages/home';
import { AppShell } from '@/widgets/app-shell';
import { withApi, withStore, withToast } from '../../.storybook/decorators';

// 単体の画面幅だけでなく、実際のヘッダー・サイドバーを含めて主従と折り返しを確認する。
const meta = {
  title: 'app/Workbench',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withStore(), withToast,
    withApi({
      '/profile/me': { displayName: '開発メンバー', avatarUrl: null, email: 'member@example.com' },
      '/notifications/unread-count': 2,
      '/kb/workspaces/team-a/spaces': [{ id: 's1', key: 'dev', name: '開発ナレッジ', visibility: 'workspace', createdAt: '' }],
      '/kb/workspaces': [{ slug: 'team-a', name: '開発チーム', canManage: false, createdAt: '' }],
      '/workspaces/team-a/tickets/assigned': { tickets: [
        { id: 't1', projectId: 'p1', projectKey: 'APP', projectName: 'FreStyle', number: 24, title: '初めての人が迷わず参加できる導線にする', typeName: '改善', statusName: '進行中', statusCategory: 'in_progress', statusColor: '#2563eb', priority: 1, dueDate: null },
        { id: 't2', projectId: 'p1', projectKey: 'APP', projectName: 'FreStyle', number: 25, title: 'チームで使うナレッジの目次を整理する', typeName: 'タスク', statusName: '未着手', statusCategory: 'todo', statusColor: '#66655f', priority: 2, dueDate: null },
      ] },
      '/kb/me/recent-pages': [
        { pageId: 'page-1', workspaceSlug: 'team-a', title: 'リリース手順', spaceId: 's1', spaceName: '開発ノート', viewedAt: '2026-09-20T09:00:00.000Z' },
        { pageId: 'page-2', workspaceSlug: 'team-a', title: '今週の設計メモ', spaceId: 's1', spaceName: '開発ノート', viewedAt: '2026-09-19T09:00:00.000Z' },
      ],
    }),
    (Story) => <MemoryRouter><Routes><Route element={<Story />}><Route index element={<MenuPage />} /></Route></Routes></MemoryRouter>,
  ],
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ホーム: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('list', { name: '取り組むチケット' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '移動先を探す' })).toBeVisible();
    await expect(canvas.getByRole('navigation', { name: 'アプリのナビゲーション' })).toBeVisible();
  },
};

export const モバイル: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('list', { name: '取り組むチケット' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'サイドメニューを開く' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: /APP-24/ })).toHaveAttribute('href', '/tickets/t1');
  },
};
