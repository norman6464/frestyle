import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { expect, userEvent, within } from 'storybook/test';
import { withApi, withRouter, withStore, withToast } from '../../../../.storybook/decorators';
import Header from './Header';

/**
 * 画面のいちばん上に固定される帯。左に柱の開閉と印、中央に検索、右に知らせと自分のメニュー。
 * 常時表示（本文の上には重ねない・自動的には隠れない）で、地は不透明。
 *
 * 行き先（ホーム・自分の担当・ナレッジ・バックログ）もワークスペース切替も**ここには無い**
 * —— すべて左の柱（GlobalSidebar）が持つ。同じ行き先を 2 か所に置かない。
 *
 * 柱を開け閉めするボタンは 1 つだけ。以前は「アプリの柱」と「画面の柱」で 2 つ並び、
 * ほぼ同じ絵のボタンが隣り合ってどちらが何を閉じるのか見分けが付かなかった。
 *
 * 狭い画面では柱が引き出しになり、三本線がその入口になる。検索は虫眼鏡アイコンに畳む。
 */
const meta = {
  title: 'widgets/app-shell/Header',
  component: Header,
  parameters: { layout: 'fullscreen' },
  args: {
    onOpenSearch: fn(),
    onToggleGlobalSidebar: fn(),
    onOpenMobileSidebar: fn(),
  },
  decorators: [
    withRouter,
    withStore(),
    withToast,
    withApi({
      '/profile/me': { displayName: '川野 拓馬', avatarUrl: null, email: 'takuma@example.com' },
      // 件数の宛先は一覧の宛先を含むので、細かいほうを先に書く。
      '/notifications/unread-count': 0,
      '/kb/workspaces': [
        { slug: 'w-3f2a9c', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true },
      ],
    }),
    (Story) => (
      <div className="min-h-[320px] bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * ふだんの見え方。行き先（ホーム・ナレッジ…）はここには無い —— 左の柱が持つ。
 * ヘッダーに残すのは柱の開閉・ロゴ・検索・通知・ユーザーだけ。
 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('link', { name: 'ナレッジ' })).toBeNull();
    await expect(canvas.getByRole('button', { name: '検索' })).toBeVisible();
    await expect(await canvas.findByText('川野 拓馬')).toBeVisible();
  },
};

/**
 * 柱を開け閉めするボタンは**この 1 つだけ**。2 つ並べない —— 絵がほぼ同じで、
 * どちらが何を閉じるのか見分けが付かなくなる（実際にそうなっていた）。
 * 押すと今の状態に応じて絵とラベルが変わる。
 */
export const 柱の開閉ボタンはひとつ: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const buttons = canvas.getAllByRole('button', { name: /サイドバーを/ });
    await expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0]);
    await expect(args.onToggleGlobalSidebar).toHaveBeenCalledTimes(1);
  },
};

/** 柱を閉じているとき。ボタンは「開く」に変わる。 */
export const 柱を閉じているとき: Story = {
  args: { globalSidebarOpen: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'サイドバーを開く' })).toBeVisible();
  },
};

/** 中央の検索ボタンを押すと onOpenSearch が呼ばれる。 */
export const 検索ボタンを押す: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '検索' }));
    await expect(args.onOpenSearch).toHaveBeenCalledTimes(1);
  },
};

/** 未読の知らせがあるとき。ベルに件数が付く。 */
export const 未読あり: Story = {
  decorators: [
    withApi({
      '/profile/me': { displayName: '川野 拓馬', avatarUrl: null, email: 'takuma@example.com' },
      '/notifications/unread-count': 5,
      '/kb/workspaces': [],
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('link', { name: '通知 (未読 5 件)' }),
    ).toBeVisible();
  },
};

/** 未読が多すぎるとき。3 桁は「99+」に丸めて、ベルを押し広げない。 */
export const 未読が多い: Story = {
  decorators: [
    withApi({
      '/profile/me': { displayName: '川野 拓馬', avatarUrl: null, email: 'takuma@example.com' },
      '/notifications/unread-count': 128,
      '/kb/workspaces': [],
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('99+')).toBeVisible();
  },
};

/** 自分の情報が取れなかったとき。壊れずに「ユーザー」と出す。 */
export const 情報が取れないとき: Story = {
  decorators: [withApi({ '/kb/workspaces': [] })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 帯は壊れない。名前だけが既定の文言になる。
    await expect(canvas.getByRole('button', { name: '検索' })).toBeVisible();
    await expect(await canvas.findByText('ユーザー')).toBeVisible();
  },
};

/**
 * 狭い画面。三本線は柱の引き出しを開く合図を送るだけで、ヘッダー自身は縦メニューを持たない
 * （行き先は柱にしか無い）。自分のメニューはここでも出す —— ログアウトの入口がそこだけのため。
 */
export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'メニュー' }));
    await expect(args.onOpenMobileSidebar).toHaveBeenCalledTimes(1);
    await expect(canvas.queryByRole('navigation')).toBeNull();
    await expect(await canvas.findByRole('button', { name: '川野 拓馬' })).toBeVisible();
  },
};

