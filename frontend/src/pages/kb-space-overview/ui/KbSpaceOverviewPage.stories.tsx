import type { Meta, StoryObj } from '@storybook/react-vite';
import { AxiosError, AxiosHeaders } from 'axios';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, waitFor, within } from 'storybook/test';
import { KbFrameLayout, KbSpaceLayout } from '@/widgets/kb-frame';
import KbSpaceOverviewPage from './KbSpaceOverviewPage';
import { kbSpaceLocation, kbSpaceRoute, withApi, withToast } from '../../../../.storybook/decorators';

const workspaces = [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
const mySpaces = [{ id: 'space-1', name: '開発部', role: 'editor' }];
const spaces = [{ id: 'space-1', key: 'space-1', name: '開発部', visibility: 'workspace', createdAt: '2026-01-01T00:00:00Z' }];

/** スペース単位の「概要」画面（段14）。凝った内容は無く、自分の役割程度を示す最小限。 */
const meta = {
  title: 'pages/kb-space-overview/KbSpaceOverviewPage',
  component: KbSpaceOverviewPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast],
} satisfies Meta<typeof KbSpaceOverviewPage>;

export default meta;
type Story = StoryObj<typeof meta>;

// 突き合わせは前から順なので、細かい宛先を先に書く（/spaces が先だと木の要求まで拾う）。
export const ふつう: Story = {
  decorators: [
    kbSpaceRoute('/kb/spaces/:spaceId', '/kb/spaces/space-1'),
    withApi({
      '/spaces/space-1/pages': { pages: [], hasHiddenChildren: false },
      '/kb/spaces/space-1': kbSpaceLocation('space-1', 'acme', '開発部'),
      '/me/spaces': mySpaces,
      '/workspaces/acme/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // スペース名は見出しとして 1 回だけ出る（サイドバー内の表示はサイドバー自身の
    // KbFrame.stories.tsx が確かめる。ここは本文だけを見る）。
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { name: '開発部' })).toBeInTheDocument();
    });
    await expect(canvas.getByText(/編集者/)).toBeInTheDocument();
  },
};

/**
 * スペース切替の「すべてのスペース」が ?workspace= で対象を持ち越したとき。
 * 所属順では acme が先だが、workspace=beta を指定しているので beta のスペースが開く。
 */
export const 対象ワークスペースを引き継ぐ: Story = {
  decorators: [
    (Story) => (
      <MemoryRouter initialEntries={['/kb/spaces?workspace=beta']}>
        <Routes>
          <Route element={<KbFrameLayout />}>
            <Route element={<KbSpaceLayout />}>
              <Route path="/kb/spaces" element={<Story />} />
              <Route path="/kb/spaces/:spaceId" element={<Story />} />
            </Route>
          </Route>
        </Routes>
      </MemoryRouter>
    ),
    withApi({
      // 入口で beta のスペースへ移ったあと、親ルートが所在の口で beta を引く。
      '/kb/spaces/space-9': kbSpaceLocation('space-9', 'beta', '営業部'),
      '/kb/workspaces/acme/me/spaces': [{ id: 'space-1', name: '開発部', role: 'editor' }],
      '/kb/workspaces/beta/me/spaces': [{ id: 'space-9', name: '営業部', role: 'viewer' }],
      '/spaces/space-9/pages': { pages: [], hasHiddenChildren: false },
      '/kb/workspaces': [
        { slug: 'acme', name: 'Acme 社', createdAt: '2026-01-01T00:00:00Z', canManage: true },
        { slug: 'beta', name: 'Beta 社', createdAt: '2026-01-01T00:00:00Z', canManage: false },
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { name: '営業部' })).toBeInTheDocument();
    });
    await expect(canvas.getByText(/閲覧者/)).toBeInTheDocument();
    await expect(canvas.queryByRole('heading', { name: '開発部' })).toBeNull();
  },
};

export const アクセスできるスペースが無い: Story = {
  // spaceId 無しの入口（/kb/spaces）でだけ再現する。特定の spaceId を指しての「見つからない」
  // とは別（そちらは別の文言になる。locateKbSpace の doc 参照）。
  decorators: [kbSpaceRoute('/kb/spaces', '/kb/spaces'), withApi({ '/me/spaces': [], '/kb/workspaces': workspaces })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText('アクセスできるスペースがありません'),
    ).toBeInTheDocument();
  },
};

/** 指したスペースが見つからない。行き止まりにせず、スペースの入口へ戻れる（親ルートが出す）。 */
export const スペースが見つからない: Story = {
  decorators: [
    kbSpaceRoute('/kb/spaces/:spaceId', '/kb/spaces/space-9'),
    withApi({
      // 所在の口は、無い・見る立場に無いスペースを 404 で返す。「読み込めない」と取り違えないよう、
      // 状態コードを持つ本物の失敗で返す。
      '/kb/spaces/space-9': () => {
        throw new AxiosError('Not Found', 'ERR_BAD_REQUEST', undefined, undefined, {
          status: 404,
          statusText: 'Not Found',
          data: { error: 'not_found' },
          headers: {},
          config: { headers: new AxiosHeaders() },
        });
      },
      '/spaces/space-1/pages': { pages: [], hasHiddenChildren: false },
      '/kb/spaces/space-1': kbSpaceLocation('space-1', 'acme', '開発部'),
      '/me/spaces': mySpaces,
      '/workspaces/acme/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'このスペースは見つかりませんでした' }),
    ).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'スペース一覧へ戻る' })).toBeVisible();
  },
};

/** スペースを読み込めない。「見つからない」とは言わず、取り直しを置く（親ルートが出す）。 */
export const スペースを読み込めない: Story = {
  decorators: [
    kbSpaceRoute('/kb/spaces/:spaceId', '/kb/spaces/space-1'),
    withApi({
      '/kb/spaces/space-1': kbSpaceLocation('space-1', 'acme', '開発部'),
      '/me/spaces': () => {
        throw new Error('offline');
      },
      '/workspaces/acme/spaces': spaces,
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('スペースを読み込めませんでした。')).toBeVisible();
    await expect(canvas.queryByRole('heading', { name: 'このスペースは見つかりませんでした' })).toBeNull();
    await expect(canvas.getAllByRole('button', { name: '再試行' }).length).toBeGreaterThan(0);
  },
};
