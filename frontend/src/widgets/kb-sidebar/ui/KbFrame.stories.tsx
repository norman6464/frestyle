import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withRouter, withToast } from '../../../../.storybook/decorators';
import KbFrame from './KbFrame';

/**
 * ナレッジの画面の枠（設計ボード ST03・見本 3a）。上に文脈バー（ワークスペース / スペース ▾ と
 * 右端の 概要・メンバー・アーカイブ）、左にページの列、右に本文。
 *
 * 左の列は 見出し（ページを探す ＋ …）→ このスペースで検索（題名で絞る）→ お気に入り・
 * すべてのページ → 木 → この場所のページだけを表示。狭い画面では文脈バーのボタンで開く
 * 引き出しになる。
 *
 * これ 1 つでサーバーからの取得までを受け持つので、見本でも**通信の返事**を差し替えて動かす
 * （呼び出しの道筋は本物のまま）。所属やスペースが 1 つも無いときは、行き止まりにせず
 * 左の列で**その場で作れる**入力欄を出す。
 */
const meta = {
  title: 'widgets/kb-sidebar/KbFrame',
  component: KbFrame,
  parameters: { layout: 'fullscreen' },
  args: {
    children: (
      <main className="flex-1 overflow-y-auto p-8">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">ここが本文</h1>
      </main>
    ),
  },
  decorators: [
    withRouter,
    withToast,
    (Story) => (
      <div className="h-[600px] bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbFrame>;

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

const leaf = (id: string, spaceId: string, title: string) => ({
  page: page(id, spaceId, title),
  children: [],
  hasHiddenChildren: false,
  parentArchived: false,
});

// はじめに ─ 使い方 ／ 議事録 ─ 9 月の議事録
const tree = {
  pages: [
    { ...leaf('s-1-p1', 's-1', 'はじめに'), children: [leaf('s-1-p3', 's-1', '使い方')] },
    { ...leaf('s-1-p2', 's-1', '議事録'), children: [leaf('s-1-p4', 's-1', '9 月の議事録')] },
  ],
  hasHiddenChildren: false,
};

// 突き合わせは前から順なので、細かい宛先を先に書く（/spaces が先だと木の要求まで拾う）。
const fullApi = {
  '/spaces/s-1/pages': tree,
  '/me/spaces': mySpaces,
  '/spaces': spaces,
  '/kb/workspaces': workspaces,
};

async function waitForTree(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(async () => {
    await expect(canvas.getByText('はじめに')).toBeVisible();
  }, { timeout: 5000 });
  return canvas;
}

/** ふつうの状態。帯に今いる場所、左に見出し・検索・入口・木が並ぶ。 */
export const 既定: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1' },
  play: async ({ canvasElement }) => {
    const canvas = await waitForTree(canvasElement);
    const place = canvas.getByRole('navigation', { name: 'いまの場所' });
    await expect(within(place).getByRole('button', { name: 'ワークスペース「開発チーム」を切り替える' })).toBeVisible();
    await expect(within(place).getByRole('button', { name: 'スペース「バックエンド定例」を切り替える' })).toBeVisible();
    const tabs = canvas.getByRole('navigation', { name: 'バックエンド定例 の画面' });
    await expect(within(tabs).getByRole('link', { name: '概要' })).toBeVisible();
    await expect(within(tabs).getByRole('link', { name: 'メンバー' })).toBeVisible();
    await expect(within(tabs).getByRole('button', { name: 'アーカイブしたページを表示' })).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('heading', { name: 'ページを探す' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'お気に入り' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'すべてのページ' })).toBeVisible();
  },
};

/** いま開いているページがあるとき。祖先が自動で開き、現在地が強調される。 */
export const 現在地つき: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1', activePageId: 's-1-p3' },
};

/**
 * このスペースで検索: 手元の木を題名で絞る。一致したページの祖先は開いて残し、本文まで探す
 * 入口（打った語を持ち越す）を添える。
 */
export const 題名で絞る: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1' },
  play: async ({ canvasElement }) => {
    const canvas = await waitForTree(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox', { name: 'このスペースで検索' }), '9 月');
    await waitFor(async () => {
      await expect(canvas.getByText('9 月の議事録')).toBeVisible();
    });
    // 祖先（議事録）は残し、一致しない枝（はじめに）は消える。
    await expect(canvas.getByText('議事録')).toBeVisible();
    await expect(canvas.queryByText('はじめに')).toBeNull();
    await expect(canvas.getByRole('button', { name: '本文も含めて「9 月」を探す' })).toBeVisible();
    // 一致の祖先は開いた形で出るが、閉じることもできる。
    await userEvent.click(canvas.getByRole('button', { name: '議事録 を閉じる' }));
    await expect(canvas.queryByText('9 月の議事録')).toBeNull();
  },
};

/** この場所のページだけを表示: 今開いているページとその子孫だけに木を絞る。もう一度押すと戻る。 */
export const この場所のページだけ: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1', activePageId: 's-1-p1' },
  play: async ({ canvasElement }) => {
    const canvas = await waitForTree(canvasElement);
    const toggle = canvas.getByRole('button', { name: 'この場所のページだけを表示' });
    await userEvent.click(toggle);
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.queryByText('議事録')).toBeNull();
    await expect(canvas.getByText('はじめに')).toBeVisible();
    await userEvent.click(toggle);
    await expect(canvas.getByText('議事録')).toBeVisible();
  },
};

/** 帯の「アーカイブ」は画面を移らず、左の木をアーカイブしたページの表示に切り替える。 */
export const アーカイブの切替: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1' },
  play: async ({ canvasElement }) => {
    const canvas = await waitForTree(canvasElement);
    const archive = canvas.getByRole('button', { name: 'アーカイブしたページを表示' });
    await userEvent.click(archive);
    await expect(archive).toHaveAttribute('aria-pressed', 'true');
    await expect(await canvas.findByRole('heading', { name: 'アーカイブしたページ' })).toBeVisible();
    // アーカイブの木では作る操作を出さない。
    await expect(canvas.queryByRole('button', { name: 'バックエンド定例 にページを追加' })).toBeNull();
  },
};

/** どこにも所属していないとき。行き止まりにせず、左の列でその場で作れる。 */
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

/** スペースの切替は、外を押すか Escape で閉じる。開いたまま残らない。 */
export const 切替を外で閉じる: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1' },
  play: async ({ canvasElement }) => {
    const canvas = await waitForTree(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'スペース「バックエンド定例」を切り替える' });
    await userEvent.click(trigger);
    await expect(await canvas.findByRole('button', { name: 'スペースを作成' })).toBeVisible();
    // ポップアップの外（本文の見出し）を押す。
    await userEvent.click(canvas.getByRole('heading', { name: 'ここが本文' }));
    await waitFor(async () => {
      await expect(canvas.queryByRole('button', { name: 'スペースを作成' })).not.toBeInTheDocument();
    });
    // 開き直して Escape でも閉じ、引き金へフォーカスが戻る。
    await userEvent.click(trigger);
    await expect(await canvas.findByRole('button', { name: 'スペースを作成' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(canvas.queryByRole('button', { name: 'スペースを作成' })).not.toBeInTheDocument();
    });
    await expect(trigger).toHaveFocus();
  },
};

/** 狭い画面。左の列は帯のボタンで開く引き出しになり、Escape で閉じて引き金へ戻る。 */
export const 狭い画面: Story = {
  decorators: [withApi(fullApi)],
  args: { workspaceSlug: 'w-3f2a9c', spaceId: 's-1' },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const open = await canvas.findByRole('button', { name: 'ページの一覧を開く' });
    await userEvent.click(open);
    const drawer = await screen.findByRole('dialog', { name: 'ページ' });
    await waitFor(async () => {
      await expect(within(drawer).getByText('はじめに')).toBeVisible();
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(canvas.queryByRole('dialog', { name: 'ページ' })).toBeNull();
    });
    await waitFor(() => expect(open).toHaveFocus());
  },
};
