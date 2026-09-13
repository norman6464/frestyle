import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { withApi, withRouter, withToast } from '../../../../.storybook/decorators';
import KbSidebar from './KbSidebar';

/**
 * ナレッジの「場所を示す面」。ワークスペースの切り替え・今いるスペースの顔・ページの木。
 *
 * 段14でスペース単位（1 つの spaceId だけ）に組み替えた。他のスペースへの移動は
 * スペースの顔の中の一時的な切替（W3 でヘッダーへ正式に移すまでの繋ぎ）が担う。
 *
 * これ 1 つでサーバーからの取得までを受け持つので、見本でも**通信の返事**を差し替えて動かす
 * （呼び出しの道筋は本物のまま）。
 *
 * 所属が 1 つも無いときは、行き止まりにせず**その場で作れる**入力欄を出す。
 */
const meta = {
  title: 'widgets/kb-sidebar/KbSidebar',
  component: KbSidebar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRouter,
    withToast,
    (Story) => (
      <div className="h-[560px] w-72 overflow-y-auto border-r border-surface-3 bg-surface-1">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

const workspaces = [
  { slug: 'w-3f2a9c', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true },
];

const spaces = [
  { id: 's-1', key: 's-1a2b3c', name: 'バックエンド定例', visibility: 'workspace', createdAt: '2026-01-01T00:00:00Z' },
  { id: 's-2', key: 's-9d8c7b', name: '営業定例', visibility: 'workspace', createdAt: '2026-02-01T00:00:00Z' },
];

const mySpaces = [
  { id: 's-1', name: 'バックエンド定例', role: 'editor' },
  { id: 's-2', name: '営業定例', role: 'viewer' },
];

const page = (id: string, spaceId: string, title: string) => ({
  id,
  spaceId,
  title,
  createdByUserId: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

const tree = (spaceId: string, titles: string[]) => ({
  pages: titles.map((title, i) => ({
    page: page(`${spaceId}-p${i + 1}`, spaceId, title),
    children: [],
    hasHiddenChildren: false,
    parentArchived: false,
  })),
  hasHiddenChildren: false,
});

// 突き合わせは前から順なので、細かい宛先を先に書く（/spaces が先だと木の要求まで拾う）。
const fullApi = {
  '/tickets/counts': { total: 18, assignedToMe: 4, overdue: 2, unassigned: 3 },
  '/spaces/s-1/pages': tree('s-1', ['はじめに', '議事録']),
  '/spaces/s-2/pages': tree('s-2', ['商談メモ']),
  '/me/spaces': mySpaces,
  '/spaces': spaces,
  '/kb/workspaces': workspaces,
};

/** ふつうの状態。今いるスペースの顔とページの木が出る。 */
export const 既定: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getByRole('button', { name: 'バックエンド定例 の操作' })).toBeVisible();
      },
      { timeout: 5000 },
    );
    await expect(canvas.getByText('はじめに')).toBeVisible();
    // 他のスペースは顔（見出し）としては出ない。切替を開くまで見えない（段14。単一スペース表示）。
    await expect(canvas.queryByRole('button', { name: '営業定例 の操作' })).not.toBeInTheDocument();
  },
};

/** いま開いているページがあるとき。祖先が自動で開き、現在地が強調される。 */
export const 現在地つき: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1', activePageId: 's-1-p1' },
};

/** どこにも所属していないとき。行き止まりにせず、その場で作れる。 */
export const 所属が無い: Story = {
  decorators: [withApi({ '/kb/workspaces': [] })],
  args: { spaceId: '' },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/まだワークスペースがありません/),
    ).toBeVisible();
  },
};

/** スペースがまだ 1 つも無いとき。ここでも作れる入口を出す。 */
export const スペースが無い: Story = {
  decorators: [withApi({ '/spaces': [], '/kb/workspaces': workspaces })],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: '' },
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/まだスペースがありません/),
    ).toBeVisible();
  },
};
