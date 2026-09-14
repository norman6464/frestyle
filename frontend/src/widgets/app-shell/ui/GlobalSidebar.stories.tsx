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

/**
 * アプリでただ 1 本の左の柱。
 *
 * 上から 行き先（ホーム・自分の担当・ナレッジ・バックログ）→ 画面ごとの区画 →
 * 区画が無いときだけスペースの一覧 → 区切りの下に通知と設定。
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
    for (const label of ['ホーム', '自分の担当', 'ナレッジ', 'バックログ', '通知', '設定']) {
      await expect(canvas.getByRole('link', { name: label })).toBeVisible();
    }
  },
};

/** スペースは最初のワークスペースの分だけ出す。柱は入口であって一覧ではない。 */
export const スペースが並ぶ: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: '設計スペース' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'その他のスペース' })).toBeVisible();
  },
};

/** スペースの節は畳める。畳むと中の行だけが消え、見出しは残る。 */
export const スペースの節を畳む: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: '設計スペース' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'スペース' }));
    await expect(canvas.queryByRole('link', { name: '設計スペース' })).toBeNull();
    await expect(canvas.getByRole('button', { name: 'スペース' })).toBeVisible();
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
    await expect(canvas.queryByRole('button', { name: 'スペース' })).toBeNull();
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
    const home = canvas.getByRole('link', { name: 'ホーム' });
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
 * 区切りより下（通知・設定）は下端に寄せる。中身が短いときに行き先の直後へ
 * くっついてこないこと —— 毎日開く面と同じ並びに見せないため。
 */
export const 通知と設定は下端: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const home = canvas.getByRole('link', { name: 'ホーム' });
    const settings = canvas.getByRole('link', { name: '設定' });
    await expect(settings.getBoundingClientRect().top - home.getBoundingClientRect().top).toBeGreaterThan(200);
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
      await expect(canvas.getByRole('link', { name: label }).clientHeight).toBeLessThan(40);
    }
  },
};

/** ワークスペースが取れなくても柱は壊れない。スペースの節が空になるだけ。 */
export const スペースが取れないとき: Story = {
  decorators: [withApi({ '/kb/workspaces': [] })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'ホーム' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: '設計スペース' })).toBeNull();
  },
};
