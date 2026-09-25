import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import NotFoundPage from './NotFoundPage';

/**
 * 存在しない URL に来たときの受け皿。
 *
 * これが無いと、打ち間違いや古いリンクで**真っ白な画面**になり、戻る手段も
 * 無いまま離脱してしまう。
 *
 * 案内の出し分けは、ログイン済みかどうかを示す目印（Cookie）だけで決める。この画面は
 * 行き先を案内するだけで権限を判定しないので、それで足りる。サーバーに問い合わせると
 * 表示が遅れ、待たずに手元の状態を読むと未確定の既定値（未ログイン扱い）で描いてしまう。
 *
 * SPA なので HTTP の 404 は返せない。せめて検索エンジンには「登録しないでほしい」と伝える。
 */
const meta = {
  title: 'pages/not-found/NotFoundPage',
  component: NotFoundPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withRouter],
} satisfies Meta<typeof NotFoundPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 目印の Cookie を、その story が要る状態に置き直す。
 *
 * Cookie はブラウザに残るので、**story をまたいで持ち越される**。片方で置いてもう片方で
 * 消す、という書き方だと実行の順番しだいで結果が変わる（実際、手元では通って CI で落ちた）。
 * 「後始末する」ではなく「毎回どちらの状態かを言い切る」形にして、順番に依存させない。
 *
 * 描画の前に置く必要がある。この画面は effect ではなく描画の途中で Cookie を読むため。
 */
function signedIn(value: boolean): Decorator {
  const Wrapped: Decorator = (Story) => {
    document.cookie = value ? 'fs_signed_in=1; path=/' : 'fs_signed_in=; path=/; max-age=0';
    return <Story />;
  };
  return Wrapped;
}

/**
 * ログインしていない人が来たとき。本文の主ボタンは「ログイン画面へ」の 1 つだけ（同じ行き先の
 * ボタンを並べない）。ヘッダーは公開ページ共通で、ロゴはホームへ・入口はログインとアカウント作成。
 */
export const 未ログイン: Story = {
  decorators: [signedIn(false)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { name: 'ページが見つかりません' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'ログイン画面へ' })).toHaveAttribute('href', '/login');
    await expect(canvas.queryByRole('link', { name: 'トップへ戻る' })).toBeNull();
    await expect(canvas.getByRole('link', { name: 'FreStyle ホーム' })).toHaveAttribute('href', '/');
    await expect(canvas.getByRole('link', { name: 'アカウントを作成' })).toBeVisible();
  },
};

/** ログイン済みの人が来たとき。ホームへ戻る 1 つだけにし、ログインや作成の入口は出さない。 */
export const ログイン済み: Story = {
  decorators: [signedIn(true)],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: 'ホームへ戻る' })).toBeVisible();
    await expect(canvas.queryByRole('link', { name: 'ログイン' })).toBeNull();
    await expect(canvas.queryByRole('link', { name: 'アカウントを作成' })).toBeNull();
  },
};
