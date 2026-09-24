import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, within } from 'storybook/test';
import { HomePage } from '@/pages/home';
import { AppShell } from '@/widgets/app-shell';
import { withApi, withStore, withToast } from '../../.storybook/decorators';

// 単体の画面幅だけでなく、実際のヘッダー・下部ナビを含めて主従と折り返しを確認する。
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
      '/kb/workspaces/team-a/favorites': [],
      '/kb/workspaces/team-a/pages/page-1/ticket-backlinks': { tickets: [] },
      '/kb/workspaces': [{ slug: 'team-a', name: '開発チーム', canManage: false, canCreateTickets: true, createdAt: '' }],
      '/me/assigned-tickets': { tickets: [
        { id: 't1', workspaceSlug: 'team-a', workspaceName: '開発チーム', projectId: 'p1', projectKey: 'APP', projectName: 'FreStyle', number: 24, title: '初めての人が迷わず参加できる導線にする', typeName: '改善', statusName: '進行中', statusCategory: 'in_progress', statusColor: '#2563eb', priority: 1, dueDate: null },
        { id: 't2', workspaceSlug: 'team-a', workspaceName: '開発チーム', projectId: 'p1', projectKey: 'APP', projectName: 'FreStyle', number: 25, title: 'チームで使うナレッジの目次を整理する', typeName: 'タスク', statusName: '未着手', statusCategory: 'todo', statusColor: '#66655f', priority: 2, dueDate: null },
      ] },
      '/kb/me/recent-pages': [
        { pageId: 'page-1', workspaceSlug: 'team-a', title: 'リリース手順', spaceId: 's1', spaceName: '開発ノート', viewedAt: '2026-09-20T09:00:00.000Z' },
        { pageId: 'page-2', workspaceSlug: 'team-a', title: '今週の設計メモ', spaceId: 's1', spaceName: '開発ノート', viewedAt: '2026-09-19T09:00:00.000Z' },
      ],
    }),
    (Story) => <MemoryRouter><Routes><Route element={<Story />}><Route index element={<HomePage />} /></Route></Routes></MemoryRouter>,
  ],
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ホーム: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('list', { name: '自分の担当' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '移動先を探す' })).toBeVisible();
    // 広い画面では行き先はヘッダーにあり、下部ナビは出ない（名前の同じナビは 1 つだけ読める）。
    await expect(canvas.getByRole('navigation', { name: '主な行き先' })).toBeVisible();
  },
};

export const モバイル: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('list', { name: '自分の担当' })).toBeVisible();
    // 行き先は下部ナビ。ホームは左の列を持たないので三本線は出ない。
    await expect(canvas.getByRole('navigation', { name: '主な行き先' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'サイドメニューを開く' })).toBeNull();
    await expect(canvas.getByRole('link', { name: /APP-24/ })).toHaveAttribute('href', '/tickets/t1');
  },
};
