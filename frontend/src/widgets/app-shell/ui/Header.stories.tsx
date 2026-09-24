import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { expect, userEvent, within } from 'storybook/test';
import { withApi, withRouter, withStore, withToast } from '../../../../.storybook/decorators';
import { SidebarSection, SidebarSlotProvider } from '@/shared/ui';
import Header from './Header';

/**
 * 画面のいちばん上に固定される帯（設計ボード ST02・ST03）。左にロゴと主な行き先
 * （ホーム・担当・ナレッジ・バックログ）、右に検索・通知・アカウント。
 * 常時表示（本文の上には重ねない・自動的には隠れない）で、地は不透明。
 *
 * 狭い画面では主な行き先を下部ナビに譲り、検索は虫眼鏡だけになる。三本線は、画面が左の列
 * （ナレッジのスペースと木など）を持つときだけ出る。
 */
const meta = {
  title: 'widgets/app-shell/Header',
  component: Header,
  parameters: { layout: 'fullscreen' },
  args: {
    onOpenSearch: fn(),
    onOpenMobileSidebar: fn(),
  },
  decorators: [
    withRouter,
    withStore(),
    withToast,
    withApi({
      '/profile/me': { displayName: '川野 拓馬', avatarUrl: null, email: 'takuma@example.com' },
      '/notifications/unread-count': 0,
    }),
    (Story, context) => (
      // 三本線は「画面が左の列を持つか」で出し分けるので、差し込み口ごと用意する。
      <SidebarSlotProvider>
        <div className="min-h-[320px] bg-surface">
          <Story />
        </div>
        {context.parameters.withScreenSection === true && (
          <SidebarSection>
            <nav aria-label="ナレッジ" />
          </SidebarSection>
        )}
      </SidebarSlotProvider>
    ),
  ],
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ふだんの見え方。今いる所（ホーム）だけ一段濃くなる。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = canvas.getByRole('navigation', { name: '主な行き先' });
    for (const label of ['ホーム', '担当', 'ナレッジ', 'バックログ']) {
      await expect(within(nav).getByRole('link', { name: label })).toBeVisible();
    }
    await expect(within(nav).getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
    await expect(canvas.getByRole('button', { name: '移動先を探す' })).toBeVisible();
    await expect(await canvas.findByRole('button', { name: '川野 拓馬 のアカウント' })).toBeVisible();
    // 左の列を持たない画面では三本線を出さない。
    await expect(canvas.queryByRole('button', { name: 'サイドメニューを開く' })).toBeNull();
  },
};

/** 検索ボタンを押すと onOpenSearch が呼ばれる。 */
export const 検索ボタンを押す: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '移動先を探す' }));
    await expect(args.onOpenSearch).toHaveBeenCalledTimes(1);
  },
};

/** 未読の知らせがあるとき。ベルに件数が付く。 */
export const 未読あり: Story = {
  decorators: [
    withApi({
      '/profile/me': { displayName: '川野 拓馬', avatarUrl: null, email: 'takuma@example.com' },
      '/notifications/unread-count': 5,
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
    }),
  ],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('99+')).toBeVisible();
  },
};

/** 自分の情報が取れなかったとき。壊れずに「ユーザー」と名乗る。 */
export const 情報が取れないとき: Story = {
  decorators: [withApi({})],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 帯は壊れない。名前だけが既定の文言になる。
    await expect(canvas.getByRole('button', { name: '移動先を探す' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'ユーザー のアカウント' })).toBeVisible();
  },
};

/** 狭い画面（左の列を持たない画面）。行き先は下部ナビにあるので帯には出ず、三本線も無い。 */
export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('navigation')).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'サイドメニューを開く' })).toBeNull();
    await expect(canvas.getByRole('button', { name: '移動先を探す' })).toBeVisible();
    // アカウントのメニューは狭い画面でも出す —— ログアウトの入口がそこだけのため。
    await expect(await canvas.findByRole('button', { name: '川野 拓馬 のアカウント' })).toBeVisible();
  },
};

/** 狭い画面で左の列を持つ画面（ナレッジなど）。三本線がその列を引き出す入口になる。 */
export const 狭い画面で左の列を持つとき: Story = {
  parameters: { withScreenSection: true },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'サイドメニューを開く' }));
    await expect(args.onOpenMobileSidebar).toHaveBeenCalledTimes(1);
  },
};
