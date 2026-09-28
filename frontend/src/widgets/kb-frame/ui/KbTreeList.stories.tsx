import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import type { KbPageTreeNode } from '@/entities/kb';
import { withRouter } from '../../../../.storybook/decorators';
import KbTreeList from './KbTreeList';

/**
 * 木の 1 段を描く。子は**入れ子のリスト**として描く。
 *
 * 平らに並べて「いま何段目か」を属性で伝える形はやめた。木だと名乗る以上、矢印キーでの
 * 移動まで用意するのが筋だが、行の中にリンクと操作ボタンが同居している以上、それは Tab とは
 * 別のもう 1 つの操作体系を作ることになる。名乗りだけ残すのは嘘なので、**名乗りを外して、
 * 段の深さは入れ子そのものに表させる**（読み上げソフトは入れ子を辿れる）。
 *
 * 字下げの数値は見た目のためだけに残してある。
 */
const meta = {
  title: 'widgets/kb-frame/KbTreeList',
  component: KbTreeList,
  parameters: { layout: 'padded' },
  decorators: [
    withRouter,
    (Story) => (
      <div className="w-64 bg-surface-1 p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbTreeList>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = (id: string, title: string) => ({
  id,
  spaceId: 's-1',
  title,
  createdByUserId: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

const node = (
  id: string,
  title: string,
  children: KbPageTreeNode[] = [],
  hasHiddenChildren = false,
): KbPageTreeNode => ({
  page: page(id, title),
  children,
  hasHiddenChildren,
  parentArchived: false,
});

const nodes: KbPageTreeNode[] = [
  node('p-1', 'はじめに'),
  node('p-2', '開発の決まりごと', [
    node('p-3', 'コードの書き方'),
    node('p-4', 'レビューの進め方', [node('p-5', '観点の一覧')]),
  ]),
  node('p-6', '議事録'),
];

const callbacks = {
  onToggle: fn(),
  onStartRename: fn(),
  onCancelRename: fn(),
  onCommitRename: fn(async () => {}),
  onCreateChild: fn(),
  onArchive: fn(),
  onUnarchive: fn(),
  onDelete: fn(),
  onMove: fn(),
  onDragStart: fn(),
  onDragEnd: fn(),
  onDragOverRow: fn(),
  onDropOnRow: fn(),
};

const base = {
  ...callbacks,
  nodes,
  depth: 0,
  parentId: null,
  hasHiddenChildren: false,
  expandedPageIds: new Set<string>(),
  workspaceSlug: 'w-3f2a9c',
  renamingPageId: null,
  draggingPageId: null,
  dropAt: null,
  archivedMode: false,
  label: 'ページ',
};

/** 全部閉じているとき。最上段だけが見える。 */
export const 閉じている: Story = {
  args: base,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'はじめに' })).toBeVisible();
    // 閉じている段の中身は描かない。
    await expect(canvas.queryByRole('link', { name: 'コードの書き方' })).toBeNull();
  },
};

/** 1 段開いたところ。 */
export const 一段開く: Story = {
  args: { ...base, expandedPageIds: new Set(['p-2']) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'コードの書き方' })).toBeVisible();
  },
};

/** 深いところまで開いたところ。入れ子で段が表れる。 */
export const 深くまで開く: Story = {
  args: { ...base, expandedPageIds: new Set(['p-2', 'p-4']) },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: '観点の一覧' })).toBeVisible();
  },
};

/** いま開いているページがあるとき。 */
export const 現在地つき: Story = {
  args: { ...base, expandedPageIds: new Set(['p-2']), activePageId: 'p-3' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: 'コードの書き方' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  },
};

/** この段に見えないページが在るとき。在ることだけを最後に添える。 */
export const 見えないページが在る: Story = {
  args: { ...base, hasHiddenChildren: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('表示できないページがあります')).toBeVisible();
  },
};

/** 1 件も無いとき。 */
export const 空: Story = {
  args: { ...base, nodes: [] },
};

/** アーカイブ済みの一覧。 */
export const アーカイブ済み: Story = {
  args: {
    ...base,
    archivedMode: true,
    label: 'アーカイブ済みのページ',
    nodes: [node('p-7', '古い議事録'), node('p-8', '使わなくなった手順')],
  },
};
