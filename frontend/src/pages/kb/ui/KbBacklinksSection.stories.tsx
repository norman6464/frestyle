import type { Meta, StoryObj } from '@storybook/react-vite';
import type { Decorator } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { KbPage } from '@/entities/kb';
import KbBacklinksSection from './KbBacklinksSection';

/**
 * KbBacklinksSection は本文末尾に置く「このページを参照しているページ」の折りたたみ。
 *
 * 0 件（取得済み）ならセクション自体を出さない — 「参照されていません」という空状態
 * メッセージはノイズになるだけ、という判断。取得中だけ最小限のローディング表示を出す。
 * 開くとアイコン付きの一覧が並び、行を押すとそのページへ遷移する。
 */
const meta = {
  title: 'pages/kb/KbBacklinksSection',
  component: KbBacklinksSection,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof KbBacklinksSection>;

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

/** 現在の URL を画面に出す（Link を押した結果、実際に遷移したかを見るための道具）。 */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="current-path">{location.pathname}</div>;
}

const withLocationProbe: Decorator = (Story) => (
  <MemoryRouter initialEntries={['/kb/p-current']}>
    <Story />
    <LocationProbe />
  </MemoryRouter>
);

/** 0 件（取得済み）。セクション自体を出さない。 */
export const 空: Story = {
  args: { pages: [], loading: false },
  decorators: [withLocationProbe],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
    await expect(canvas.queryByText(/参照しているページ/)).not.toBeInTheDocument();
  },
};

/** 読めなかった。0 件（何も出さない）と取り違えないよう、読めなかったことと取り直しを出す。 */
export const 読み込めない: Story = {
  args: { pages: [], loading: false, error: '参照しているページを読み込めませんでした。', onRetry: fn() },
  decorators: [withLocationProbe],
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('参照しているページを読み込めませんでした。')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** 取得中。最小限のローディング表示だけ出す（トグルはまだ無い）。 */
export const 読み込み中: Story = {
  args: { pages: [], loading: true },
  decorators: [withLocationProbe],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('参照しているページを確認しています…')).toBeVisible();
    await expect(canvas.queryByRole('button')).not.toBeInTheDocument();
  },
};

/** 件数が見出しに出て、押すと一覧が開く。 */
export const 件数と展開: Story = {
  args: {
    pages: [page('p-ref-1', '週次定例のメモ'), page('p-ref-2', '設計レビューの議事録')],
    loading: false,
  },
  decorators: [withLocationProbe],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole('button', { name: 'このページを参照しているページ（2）' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // 閉じている間は行が見えない。
    await expect(canvas.queryByRole('link')).not.toBeInTheDocument();

    await userEvent.click(toggle);

    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByRole('link', { name: /週次定例のメモ/ })).toBeVisible();
    await expect(canvas.getByRole('link', { name: /設計レビューの議事録/ })).toBeVisible();
  },
};

/** アイコン付きの行をクリックすると、そのページへ実際に遷移する。 */
export const クリックで遷移: Story = {
  args: {
    pages: [page('p-ref-1', '週次定例のメモ')],
    loading: false,
  },
  decorators: [withLocationProbe],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /このページを参照しているページ/ }));

    const link = canvas.getByRole('link', { name: /週次定例のメモ/ });
    await expect(link).toHaveAttribute('href', '/kb/p-ref-1');

    await userEvent.click(link);

    await expect(canvas.getByTestId('current-path')).toHaveTextContent('/kb/p-ref-1');
  },
};
