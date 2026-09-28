import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { KbPage, KbPageTreeNode } from '@/entities/kb';
import { withRouter } from '../../../../.storybook/decorators';
import KbPageRow from './KbPageRow';

/**
 * ナレッジの木の 1 行。開閉の三角・アイコン・題名のリンク・右端の操作。
 *
 * 開閉は**リンクとは別のボタン**にしてある。行そのものを押すと開閉する作りだと、
 * 「開くつもりで押したらページが切り替わった」が必ず起きる。
 *
 * アイコンは、子を持つページがフォルダ、持たないページが紙。ただし**見える子が居るか**で
 * 選ぶので、伏せた子しか居ないページは紙のまま。ここでフォルダにすると、三角が無いのに
 * フォルダという食い違った行になるうえ、「この下に何かある」ことを形からも漏らしてしまう。
 *
 * 木の項目（treeitem）だとは名乗らない。矢印キーでの移動を用意しないまま名乗るのは嘘になり、
 * 用意しようにも行の中にリンクと操作ボタンが同居している。段の深さは入れ子が、いま開いている
 * ページは aria-current が表す — どちらも標準の意味で、別の約束をしない。
 */
const meta = {
  title: 'widgets/kb-frame/KbPageRow',
  component: KbPageRow,
  parameters: { layout: 'padded' },
  decorators: [
    withRouter,
    (Story) => (
      // この部品が返すのは li ではなく div。実物（KbTreeList）と同じく li で包んでから
      // ul に入れる（ul の直下に li 以外を置くと一覧として壊れる）。
      <ul className="w-64 bg-surface-1 p-2">
        <li>
          <Story />
        </li>
      </ul>
    ),
  ],
} satisfies Meta<typeof KbPageRow>;

export default meta;
type Story = StoryObj<typeof meta>;

const page = (id: string, title: string): KbPage => ({
  id,
  spaceId: 's-1',
  title,
  createdByUserId: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
  parentId: null,
  archivedAt: null,
  icon: null,
  lastEditedByUserId: null,
  visibility: 'space',
});

const leaf: KbPageTreeNode = {
  page: page('p-1', '設計メモ'),
  children: [],
  hasHiddenChildren: false,
  parentArchived: false,
};

const parent: KbPageTreeNode = {
  page: page('p-2', '開発の決まりごと'),
  children: [
    { page: page('p-3', 'コードの書き方'), children: [], hasHiddenChildren: false, parentArchived: false },
  ],
  hasHiddenChildren: false,
  parentArchived: false,
};

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
  depth: 0,
  siblings: [leaf],
  index: 0,
  parentId: null,
  expanded: false,
  workspaceSlug: 'w-3f2a9c',
  active: false,
  renaming: false,
  archivedMode: false,
  dragging: false,
  dropZone: null,
};

/** 子を持たないページ。紙のアイコン。三角の場所は空けて、字下げを揃える。 */
export const 末端のページ: Story = {
  args: { ...base, node: leaf },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: '設計メモ' })).toBeVisible();
    await expect(canvasElement.querySelector('[data-icon="page"]')).not.toBeNull();
  },
};

/** 子を持つページ（閉じている）。フォルダのアイコンと三角。 */
export const 子を持つページ: Story = {
  args: { ...base, node: parent, siblings: [parent] },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-icon="page-group"]')).not.toBeNull();
  },
};

/** 開いているとき。アイコンが開いた形に変わる。 */
export const 開いている: Story = {
  args: { ...base, node: parent, siblings: [parent], expanded: true },
};

/**
 * 伏せた子しか居ないページ。**紙のまま**にする。
 * フォルダにすると三角が無いのにフォルダ、という食い違いになる。
 */
export const 伏せた子だけを持つ: Story = {
  args: {
    ...base,
    node: { ...leaf, hasHiddenChildren: true },
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-icon="page"]')).not.toBeNull();
    await expect(canvasElement.querySelector('[data-icon="page-group"]')).toBeNull();
  },
};

/** 絵文字を設定したページ。開閉の見た目（紙）より絵文字を優先する。 */
export const 絵文字のアイコン: Story = {
  args: {
    ...base,
    node: { ...leaf, page: { ...leaf.page, icon: { type: 'emoji', value: '📘' } } },
  },
  play: async ({ canvasElement }) => {
    const glyph = canvasElement.querySelector('[data-icon="emoji"]');
    await expect(glyph).not.toBeNull();
    await expect(glyph).toHaveTextContent('📘');
    await expect(canvasElement.querySelector('[data-icon="page"]')).toBeNull();
  },
};

/**
 * 子を持つページに絵文字を設定したとき。フォルダの絵より絵文字を優先する
 * ―― 開閉は三角が別に伝えるので、絵文字に差し替えても「開いているか」は消えない。
 */
export const 子を持つページの絵文字: Story = {
  args: {
    ...base,
    node: { ...parent, page: { ...parent.page, icon: { type: 'emoji', value: '📘' } } },
    siblings: [parent],
  },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-icon="emoji"]')).not.toBeNull();
    await expect(canvasElement.querySelector('[data-icon="page-group"]')).toBeNull();
    // 三角は変わらず出る（開閉の情報は消えない）。
    await expect(
      within(canvasElement).getByRole('button', { name: '開発の決まりごと を開く' }),
    ).toBeInTheDocument();
  },
};

/** いま開いているページ。強調される。 */
export const いま開いている行: Story = {
  args: { ...base, node: leaf, active: true },
};

/** 段が深いとき。 */
export const 深い段: Story = {
  args: { ...base, node: leaf, depth: 3, parentId: 'p-9' },
};

/** 題名を書き換えている最中。 */
export const 題名を書き換え中: Story = {
  args: { ...base, node: leaf, renaming: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'ページの題名' }),
    ).toHaveValue('設計メモ');
  },
};

/** 三角を押すと開閉が親へ伝わる（ページは切り替わらない）。 */
export const 三角を押す: Story = {
  args: { ...base, node: parent, siblings: [parent] },
  play: async ({ args, canvasElement }) => {
    const toggle = within(canvasElement).getByRole('button', { name: '開発の決まりごと を開く' });
    await userEvent.click(toggle);
    await expect(args.onToggle).toHaveBeenCalledWith('p-2');
  },
};

/** つかんで動かしている最中。 */
export const つかんでいる: Story = {
  args: { ...base, node: leaf, dragging: true },
};

/** 落とす先が「この行の中」のとき。枠で示す。 */
export const 落下先が中: Story = {
  args: { ...base, node: parent, siblings: [parent], dropZone: 'into' },
};

/** 落とす先が「この行の上」のとき。線で示す。並べ替えと入れ子を見た目で分ける。 */
export const 落下先が上: Story = {
  args: { ...base, node: leaf, dropZone: 'before' },
};

/** アーカイブ済みを見ているとき。動かせない。 */
export const アーカイブ済み: Story = {
  args: {
    ...base,
    node: { ...leaf, page: { ...leaf.page, archivedAt: '2026-09-02T00:00:00Z' } },
    archivedMode: true,
  },
};
