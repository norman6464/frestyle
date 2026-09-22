import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withRouter } from '../../../../.storybook/decorators';
import { SidebarSection, SidebarSlotProvider } from '@/shared/ui';
import GlobalSidebar from './GlobalSidebar';

const workspaces = [{ slug: 'acme', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
const spaces = [
  { id: 'sp-1', workspaceId: 'w-1', name: '設計スペース', createdAt: '', updatedAt: '' },
  { id: 'sp-2', workspaceId: 'w-1', name: '運用スペース', createdAt: '', updatedAt: '' },
];
/** 上限（5）を超える 8 件。柱に出るのは先頭 5 件、残りは「すべてのスペース」の +3。 */
const manySpaces = Array.from({ length: 8 }, (_, i) => ({
  id: `sp-${i + 1}`,
  workspaceId: 'w-1',
  name: `スペース ${i + 1}`,
  createdAt: '',
  updatedAt: '',
}));

/**
 * アプリでただ 1 本の左の柱。
 *
 * 上から 行き先（ホーム・自分の担当・ナレッジ・バックログ）→ 画面ごとの区画 →
 * 区画が無いときだけスペースの一覧。
 *
 * 通知と設定は持たない。通知はヘッダーのベル、設定はユーザーメニューが唯一の常設入口
 * （以前は柱の下段にも並んでいて、同じ目的地の入口が 2 か所ずつあった）。
 *
 * 以前は「アプリの柱」と「画面の柱（ナレッジの木・バックログのプロジェクト）」が横に
 * 2 本並んでいた。本文が痩せるうえ、開閉のボタンもヘッダーに 2 つ並んで見分けが付かない。
 * 柱は 1 本にして、画面ごとの中身は差し込み口（shared/ui/SidebarSlot）から入れる。
 */
const meta = {
  title: 'widgets/app-shell/GlobalSidebar',
  component: GlobalSidebar,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withRouter,
    // 宛先は前方一致で選ばれるので、細かいほう（spaces）を先に書く。
    withApi({ '/kb/workspaces/acme/spaces': spaces, '/kb/workspaces': workspaces }),
    (Story) => (
      <div className="flex h-[560px] bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GlobalSidebar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const label of ['ホーム', '自分の担当', 'ナレッジ', 'バックログ']) {
      await expect(canvas.getByRole('link', { name: label })).toBeVisible();
    }
    // 通知と設定はヘッダー側が唯一の入口。柱には無い。
    await expect(canvas.queryByRole('link', { name: '通知' })).toBeNull();
    await expect(canvas.queryByRole('link', { name: '設定' })).toBeNull();
  },
};

/**
 * スペースはワークスペースの名前を見出しにして並べる（「開発チームのスペース」）。
 * 名前が無いと、所属が 2 つ以上のときにどちらのスペースか取り違える。
 * 末尾の「すべてのスペース」が一覧画面への入口。柱は入口であって一覧ではない。
 */
export const スペースが並ぶ: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: '設計スペース' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '開発チームのスペース' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'すべてのスペース' })).toBeVisible();
    // 所属が 1 つならワークスペースの切替は出さない。
    await expect(canvas.queryByRole('combobox', { name: 'スペースを並べるワークスペース' })).toBeNull();
  },
};

/** スペースの節は畳める。畳むと中の行だけが消え、見出しは残る。 */
export const スペースの節を畳む: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: '設計スペース' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '開発チームのスペース' }));
    await expect(canvas.queryByRole('link', { name: '設計スペース' })).toBeNull();
    await expect(canvas.queryByRole('link', { name: 'すべてのスペース' })).toBeNull();
    await expect(canvas.getByRole('button', { name: '開発チームのスペース' })).toBeVisible();
  },
};

/**
 * スペースが多くても柱は伸びない。先頭 5 件だけ出し、残りの数を「すべてのスペース」に
 * 添える（+3）。以前は上限なしで全件並び、20 件あると行き先が画面の外へ押し出された。
 */
export const スペースが上限を超えるとき: Story = {
  decorators: [withApi({ '/kb/workspaces/acme/spaces': manySpaces, '/kb/workspaces': workspaces })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: 'スペース 5' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: 'スペース 6' })).toBeNull();
    await expect(canvas.getByRole('link', { name: 'すべてのスペース +3' })).toBeVisible();
  },
};

/**
 * 所属が 2 つ以上なら、どのワークスペースのスペースを並べるかを選べる。
 * 選ぶと見出しも一覧も切り替わる。
 */
export const ワークスペースが複数のとき: Story = {
  decorators: [
    withApi({
      '/kb/workspaces/acme/spaces': spaces,
      '/kb/workspaces/beta/spaces': [{ id: 'sp-9', workspaceId: 'w-2', name: '営業スペース', createdAt: '', updatedAt: '' }],
      '/kb/workspaces': [
        ...workspaces,
        { slug: 'beta', name: '営業チーム', createdAt: '2026-01-01T00:00:00Z', canManage: false },
      ],
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: '設計スペース' })).toBeVisible();
    const picker = canvas.getByRole('combobox', { name: 'スペースを並べるワークスペース' });
    await userEvent.click(picker);
    await userEvent.click(await within(document.body).findByRole('option', { name: '営業チーム' }));
    await expect(await canvas.findByRole('link', { name: '営業スペース' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: '設計スペース' })).toBeNull();
    await expect(canvas.getByRole('button', { name: '営業チームのスペース' })).toBeVisible();
  },
};

/**
 * 画面ごとの区画が差し込まれたとき（ナレッジならスペースの顔とページの木、バックログなら
 * プロジェクトと絞り込み）。**スペースの一覧は引っ込む** —— 区画のほうが今いるスペースを
 * 詳しく出しており、同じものが上下に二重になるため。
 */
export const 画面の区画が入るとき: Story = {
  decorators: [
    (Story) => (
      <SidebarSlotProvider>
        <Story />
        <SidebarSection>
          <nav aria-label="ナレッジ" className="flex flex-col">
            <p className="px-2 py-1.5 text-sm font-semibold">開発ナレッジ</p>
            <a href="#a" className="px-2 py-1.5 text-sm">
              アーキテクチャ概要
            </a>
          </nav>
        </SidebarSection>
      </SidebarSlotProvider>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 差し込まれた中身は柱の中に出る（DOM 上も柱の中）。
    await expect(await canvas.findByRole('navigation', { name: 'ナレッジ' })).toBeVisible();
    await expect(canvas.getByText('アーキテクチャ概要')).toBeVisible();
    // 行き先は消えない。
    await expect(canvas.getByRole('link', { name: 'ホーム' })).toBeVisible();
    // スペースの一覧は引っ込む。
    await expect(canvas.queryByRole('button', { name: '開発チームのスペース' })).toBeNull();
    await expect(canvas.queryByRole('link', { name: 'すべてのスペース' })).toBeNull();
  },
};

/**
 * 畳んだとき。柱は場所を取らなくなり（本文が全幅になる）、左端に触れるか ⌘\ で浮いて出る。
 * 畳む・戻すの操作はヘッダーのボタンが持つ —— 柱の中にも同じボタンを置くと、同じことを
 * するボタンが 2 つになる。
 */
export const 畳んだとき: Story = {
  args: { storageKey: 'sb.panel.global.collapsed' },
  decorators: [
    (Story) => {
      // 他の story と鍵を分けて、畳んだ状態を持ち込まないようにする。
      localStorage.setItem('sb.panel.global.collapsed', JSON.stringify('collapsed'));
      return <Story />;
    },
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const home = canvas.getByText('ホーム').closest('a')!;
    // 画面の外へ退いている（本文の幅を取らない・押しても反応しない）。
    await expect(home.getBoundingClientRect().right).toBeLessThanOrEqual(0);
    // 左端の細い帯に触れると浮いて出る。帯は読み上げには出さない（見た目だけの仕掛け）。
    const edge = canvasElement.querySelector('div[aria-hidden="true"].fixed.w-2') as HTMLElement;
    await userEvent.hover(edge);
    await waitFor(async () => {
      await expect(home.getBoundingClientRect().right).toBeGreaterThan(0);
    });
  },
};

/**
 * スペースの一覧が取れなかったとき。0 件と区別して「取得できませんでした」と再試行を出す。
 * 以前は黙って節ごと消えていて、権限の問題か通信の問題か、それとも本当に 0 件なのかが
 * 見分けられなかった。
 */
export const スペースの取得に失敗したとき: Story = {
  decorators: [
    // 見本は「返す中身」なので、失敗させたいときは関数から投げる（Error を値として置くと 200 で返る）。
    withApi({
      '/kb/workspaces/acme/spaces': () => {
        throw new Error('boom');
      },
      '/kb/workspaces': workspaces,
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('スペースを取得できませんでした');
    await expect(canvas.getByRole('button', { name: '再試行' })).toBeVisible();
    // 一覧画面への入口は失敗しても残す（そちらから辿り直せる）。
    await expect(canvas.getByRole('link', { name: 'すべてのスペース' })).toBeVisible();
  },
};

/** スペースが 1 件も無いとき。空であることを言う（黙って節を消さない）。 */
export const スペースが無いとき: Story = {
  decorators: [withApi({ '/kb/workspaces/acme/spaces': [], '/kb/workspaces': workspaces })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('スペースがありません')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'すべてのスペース' })).toBeVisible();
  },
};

/**
 * 区切りの無い日本語のラベルは、幅が足りないと文字単位で折り返され「縦書きのように
 * 見える」崩れ方をする（実機で確認済み・以前はヘッダーの横並びナビで起きていた）。
 * 柱へ移したあとも同じ risk があるので、1 行に収まることを高さで確かめる。
 */
export const ラベルが折り返さない: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const label of ['ホーム', '自分の担当', 'ナレッジ', 'バックログ']) {
      const link = canvas.getByRole('link', { name: label });
      await expect(link.clientHeight).toBe(44);
      await expect(link.querySelector('span')!.clientHeight).toBeLessThan(24);
    }
  },
};

/** ワークスペースに 1 つも属していなければ、スペースの節そのものを出さない。柱は壊れない。 */
export const ワークスペースが無いとき: Story = {
  decorators: [withApi({ '/kb/workspaces': [] })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'ホーム' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: '設計スペース' })).toBeNull();
    await expect(canvas.queryByRole('link', { name: 'すべてのスペース' })).toBeNull();
  },
};
