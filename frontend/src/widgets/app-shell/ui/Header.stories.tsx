import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { expect, userEvent, within } from 'storybook/test';
import { withApi, withRouter, withStore, withToast } from '../../../../.storybook/decorators';
import Header from './Header';

/**
 * 画面のいちばん上に固定される帯。左に印、中央に行き先と検索、右に知らせと自分のメニュー。
 * 常時表示（本文の上には重ねない・自動的には隠れない）で、地は不透明。
 *
 * 狭い画面ではナビが畳まれ、三本線のボタンから縦に開く。検索は虫眼鏡アイコンに畳む。
 *
 * 行き先の一覧は 1 か所（`model/navigation.ts`）だけが持っていて、この帯・畳んだメニュー・
 * サイドバーが同じものを読む。増やすときも 1 行足せば全部に出る。
 *
 * ワークスペース切替はここには無い（`KbSidebar` 先頭にある）。
 */
const meta = {
  title: 'widgets/app-shell/Header',
  component: Header,
  parameters: { layout: 'fullscreen' },
  args: {
    onOpenSearch: fn(),
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

/** ふだんの見え方。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'ナレッジ' })).toBeVisible();
    await expect(await canvas.findByText('川野 拓馬')).toBeVisible();
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
    // ナビは出る。名前だけが既定の文言になる。
    await expect(canvas.getByRole('navigation', { name: 'メインナビゲーション' })).toBeVisible();
    await expect(await canvas.findByText('ユーザー')).toBeVisible();
  },
};

/** 狭い画面。ナビが畳まれ、三本線から開く。 */
export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'メニュー' }));
    await expect(canvas.getByRole('navigation', { name: 'モバイルナビゲーション' })).toBeVisible();
  },
};

/**
 * デスクトップ幅の下限付近（md ブレークポイント直後・DevTools を開いた状態などでよく
 * 起きる帯）。ナビはまだ畳まれないが幅は十分ではない — ここでラベルが文字単位で
 * 折り返され「縦書きのように見える」崩れ方をしていた。
 */
export const デスクトップの下限付近_ナビが折り返さない: Story = {
  decorators: [
    // globals.viewport は Storybook manager 側のプレビュー iframe だけを縮める設定で、
    // このテストランナー（vitest --project=storybook）では実際のブラウザ幅に反映されない
    // （実測: window.innerWidth は常に 1200 のまま）。DOM 上の利用可能幅そのものを狭める。
    (StoryFn) => (
      <div style={{ width: '780px', overflow: 'hidden' }}>
        <StoryFn />
      </div>
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 1 行のままであることを高さで確かめる（折り返すと複数行ぶん高くなる）。
    for (const label of ['ホーム', 'ナレッジ', 'バックログ']) {
      await expect(canvas.getByRole('link', { name: label }).clientHeight).toBeLessThan(40);
    }
  },
};
