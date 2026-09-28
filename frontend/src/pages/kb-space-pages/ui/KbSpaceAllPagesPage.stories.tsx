import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import KbSpaceAllPagesPage from './KbSpaceAllPagesPage';
import { kbSpaceLocation, kbSpaceRoute, withApi, withToast } from '../../../../.storybook/decorators';

const workspaces = [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
const mySpaces = [{ id: 'space-1', name: '開発部', role: 'editor' }];
const spaces = [{ id: 'space-1', key: 'space-1', name: '開発部', visibility: 'workspace', createdAt: '2026-01-01T00:00:00Z' }];

const page = (id: string, title: string) => ({
  id,
  spaceId: 'space-1',
  title,
  createdByUserId: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

/** スペース単位の「すべてのページ」（段14）。木を深さ優先で開いた、フラットな一覧。 */
const meta = {
  title: 'pages/kb-space-pages/KbSpaceAllPagesPage',
  component: KbSpaceAllPagesPage,
  parameters: { layout: 'fullscreen' },
  // 通知の箱は枠ごと包む（枠も通知を出す）。デコレータは先に書いたものほど内側になる。
  // ルート（枠とスペースの親ルート）は各 story で API の見本より内側に置く。親ルートがスペースを
  // 解決するまで画面を描かないので、API の見本が画面の内側にあると差し替えが効かない。
  decorators: [withToast],
} satisfies Meta<typeof KbSpaceAllPagesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// 突き合わせは前から順（先に一致した宛先を採用）なので、細かい宛先を先に書く
// （/spaces が先だと /spaces/space-1/pages 等まで拾ってしまう）。
export const ふつう: Story = {
  decorators: [
    kbSpaceRoute('/kb/spaces/:spaceId/pages', '/kb/spaces/space-1/pages'),
    withApi({
      '/spaces/space-1/pages': {
        pages: [
          { page: page('p1', '設計メモ'), children: [], hasHiddenChildren: false },
          {
            page: page('p2', '議事録'),
            children: [{ page: page('p2-1', '第1回'), children: [], hasHiddenChildren: false }],
            hasHiddenChildren: false,
          },
        ],
        hasHiddenChildren: false,
      },
      '/kb/spaces/space-1': kbSpaceLocation('space-1', 'acme', '開発部'),
      '/me/spaces': mySpaces,
      '/workspaces/acme/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    // 同じページがサイドバーの木にも出るので（同じ取得口を使うため実際そうなる）、
    // 本文（<main>）だけを見る。
    const main = within(within(canvasElement).getByRole('main'));
    await waitFor(async () => {
      await expect(main.getByText('設計メモ')).toBeInTheDocument();
    });
    await expect(main.getByText('議事録')).toBeInTheDocument();
    await expect(main.getByText('第1回')).toBeInTheDocument();
  },
};

export const ページが無い: Story = {
  decorators: [
    kbSpaceRoute('/kb/spaces/:spaceId/pages', '/kb/spaces/space-1/pages'),
    withApi({
      '/spaces/space-1/pages': { pages: [], hasHiddenChildren: false },
      '/kb/spaces/space-1': kbSpaceLocation('space-1', 'acme', '開発部'),
      '/me/spaces': mySpaces,
      '/workspaces/acme/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    const main = within(within(canvasElement).getByRole('main'));
    await expect(await main.findByText('ページがありません')).toBeInTheDocument();
  },
};
