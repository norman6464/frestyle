import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import KbSpaceMembersPage from './KbSpaceMembersPage';
import { kbFrameRoute, withApi, withToast } from '../../../../.storybook/decorators';

const workspaces = [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
const mySpaces = [{ id: 'space-1', name: '開発部', role: 'editor' }];
const spaces = [{ id: 'space-1', key: 'space-1', name: '開発部', visibility: 'workspace', createdAt: '2026-01-01T00:00:00Z' }];

/** スペースメンバー（段9・段14）。読み取り専用 — 停止・役割変更などの admin 操作は無い。 */
const meta = {
  title: 'pages/kb-space-members/KbSpaceMembersPage',
  component: KbSpaceMembersPage,
  parameters: { layout: 'fullscreen' },
  // 通知の箱は枠ごと包む（枠も通知を出す）。デコレータは先に書いたものほど内側になる。
  decorators: [kbFrameRoute('/kb/spaces/:spaceId/members', '/kb/spaces/space-1/members'), withToast],
} satisfies Meta<typeof KbSpaceMembersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ふつう: Story = {
  decorators: [
    withApi({
      '/spaces/space-1/pages': { pages: [], hasHiddenChildren: false },
      '/spaces/space-1/members': [
        { userId: 1, name: '田中 太郎', avatarUrl: '', role: 'admin', via: 'direct' },
        { userId: 2, name: '佐藤 花子', avatarUrl: '', role: 'editor', via: 'workspace' },
      ],
      '/me/spaces': mySpaces,
      '/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('田中 太郎')).toBeInTheDocument();
    });
    await expect(canvas.getByText('佐藤 花子')).toBeInTheDocument();
    await expect(canvas.getByText('ワークスペース全体')).toBeInTheDocument();
  },
};

export const メンバーが無い: Story = {
  decorators: [
    withApi({
      '/spaces/space-1/pages': { pages: [], hasHiddenChildren: false },
      '/spaces/space-1/members': [],
      '/me/spaces': mySpaces,
      '/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('このスペースにはまだメンバーがいません'),
    ).toBeInTheDocument();
  },
};
