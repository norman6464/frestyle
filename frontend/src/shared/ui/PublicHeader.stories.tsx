import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { routerAt } from '../../../.storybook/decorators';
import PublicHeader from './PublicHeader';

/**
 * ログインの前にも開く公開ページ（招待リンク・404 など）で共通の帯。
 *
 * - ロゴは 1 つで、どの画面でも「FreStyle ホーム」として / へ（読み上げ名と行き先を一致させる）
 * - 未ログインなら、いま居るページ以外の入口（ログイン・アカウントを作成）を出す。自分自身への
 *   入口は出さない（押しても同じ場所に留まるだけで、何も起きなかったように見えるため）
 * - ログイン済みなら「ホームへ」だけを出す
 */
const meta = {
  title: 'shared/PublicHeader',
  component: PublicHeader,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof PublicHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * ログイン済みかの目印（Cookie）を、見本ごとに言い切る。Cookie はブラウザに残り、見本をまたいで
 * 持ち越されるので、「後始末する」ではなく「毎回どちらの状態かを置く」形にして順番に依存させない。
 * ヘッダーは effect ではなく描画の途中で目印を読むので、描画の前に置く。
 */
function signedIn(value: boolean): Decorator {
  const Wrapped: Decorator = (Story) => {
    document.cookie = value ? 'fs_signed_in=1; path=/' : 'fs_signed_in=; path=/; max-age=0';
    return <Story />;
  };
  return Wrapped;
}

/** 未ログインでログイン画面にいるとき。入口は「アカウントを作成」だけ。 */
export const ログイン画面: Story = {
  decorators: [signedIn(false), routerAt('/login')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'FreStyle ホーム' })).toHaveAttribute('href', '/');
    await expect(canvas.getByRole('link', { name: /アカウントを作成/ })).toBeVisible();
    // 自分自身への入口は出さない。
    await expect(canvas.queryByRole('link', { name: 'ログイン' })).toBeNull();
  },
};

/** 未ログインでアカウント作成の画面にいるとき。入口は「ログイン」に入れ替わる。 */
export const アカウント作成画面: Story = {
  decorators: [signedIn(false), routerAt('/signup')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'ログイン' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: /アカウントを作成/ })).toBeNull();
  },
};

/** 未ログインで招待リンクを開いたとき。ログインとアカウント作成の両方を出す。 */
export const 招待リンク: Story = {
  decorators: [signedIn(false), routerAt('/invite')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'ログイン' })).toHaveAttribute('href', '/login');
    await expect(canvas.getByRole('link', { name: 'アカウントを作成' })).toHaveAttribute('href', '/signup');
  },
};

/** ログイン済みで公開ページにいるとき。「ホームへ」だけにし、ログインや作成の入口は出さない。 */
export const ログイン済み: Story = {
  decorators: [signedIn(true), routerAt('/invite')],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'ホームへ' })).toHaveAttribute('href', '/');
    await expect(canvas.queryByRole('link', { name: 'ログイン' })).toBeNull();
    await expect(canvas.queryByRole('link', { name: 'アカウントを作成' })).toBeNull();
  },
};
