import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import KbSpaceFavoritesPage from './KbSpaceFavoritesPage';
import { routerWithParam, withApi, withToast } from '../../../../.storybook/decorators';

const workspaces = [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
const mySpaces = [{ id: 'space-1', name: '開発部', role: 'editor' }];
const spaces = [{ id: 'space-1', key: 'space-1', name: '開発部', visibility: 'workspace', createdAt: '2026-01-01T00:00:00Z' }];

/** スペース単位の「お気に入り」（段14・段7）。今いるスペースで星を付けたページだけを出す。 */
const meta = {
  title: 'pages/kb-space-favorites/KbSpaceFavoritesPage',
  component: KbSpaceFavoritesPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast, routerWithParam('/kb/spaces/:spaceId/favorites', '/kb/spaces/space-1/favorites')],
} satisfies Meta<typeof KbSpaceFavoritesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ふつう: Story = {
  decorators: [
    withApi({
      '/spaces/space-1/pages': { pages: [], hasHiddenChildren: false },
      '/favorites': [
        { pageId: 'p1', title: '設計メモ', icon: { type: 'emoji', value: '📘' }, spaceId: 'space-1', spaceName: '開発部', createdAt: '2026-09-01T00:00:00Z' },
        { pageId: 'p2', title: '議事録', icon: null, spaceId: 'space-1', spaceName: '開発部', createdAt: '2026-09-02T00:00:00Z' },
      ],
      '/me/spaces': mySpaces,
      '/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('設計メモ')).toBeInTheDocument();
    });
    await expect(canvas.getByText('議事録')).toBeInTheDocument();
  },
};

export const お気に入りが無い: Story = {
  decorators: [
    withApi({
      '/spaces/space-1/pages': { pages: [], hasHiddenChildren: false },
      '/favorites': [],
      '/me/spaces': mySpaces,
      '/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('このスペースにお気に入りがありません')).toBeInTheDocument();
  },
};
