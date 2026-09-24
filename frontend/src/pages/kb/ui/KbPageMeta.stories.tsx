import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import KbPageMeta from './KbPageMeta';

/**
 * 題名の下に出すバイライン（見本 3a）。左から 最終編集 → 公開範囲 → ラベル → 権限の印、
 * 右端に 閲覧数・読了時間・保存状態。
 *
 * lastEditedBy / lastEditedAt が無ければその部分だけ省く（旧応答・未保存のページの
 * どちらも該当し得るので、無いことを匂わせる空欄は置かない）。公開範囲・保存状態は
 * それでも要るので、行ごとは消さない。
 */
const meta = {
  title: 'pages/kb/KbPageMeta',
  component: KbPageMeta,
  parameters: { layout: 'padded' },
  args: {
    lastEditedBy: { userId: 1, name: '田中 太郎' },
    // 'Z' を付けない — 実行環境のタイムゾーンによらず、書いたとおりの時刻として読める。
    lastEditedAt: '2026-09-06T13:05:00',
  },
} satisfies Meta<typeof KbPageMeta>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 名前が引けたとき。 */
export const 名前あり: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('田中 太郎')).toBeVisible();
    await expect(within(canvasElement).getByText(/が最終編集 · 9\/6/)).toBeVisible();
  },
};

/** 名前が引けなかったとき。行は消さず「不明なユーザー」で埋める。 */
export const 名前が引けない: Story = {
  args: { lastEditedBy: { userId: 1, name: '' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('不明なユーザー')).toBeVisible();
  },
};

/** まだ一度も保存されていない（旧応答も同じ形）。最終編集の部分だけ省き、公開範囲は出す。 */
export const 最終編集が無い: Story = {
  args: { lastEditedBy: null, lastEditedAt: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/が最終編集/)).toBeNull();
    await expect(within(canvasElement).getByText('スペース')).toBeVisible();
  },
};

/** 公開範囲バッジ（段 13）。既定値は 'space' で、指定が無くてもこの見え方になる。 */
export const 公開範囲_全体公開: Story = {
  args: { visibility: 'public' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('全体公開')).toBeVisible();
  },
};

export const 公開範囲_スペース既定: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('スペース')).toBeVisible();
  },
};

/** 'private' は作成者以外に一切見せない特別な状態なので、他と違う目立ち方にする。 */
export const 公開範囲_非公開: Story = {
  args: { visibility: 'private' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('非公開')).toBeVisible();
  },
};

/** ラベル（段 8）。チケットと同じ labelPaint で塗り分ける。 */
export const ラベルあり: Story = {
  args: {
    labels: [
      { id: 'l-1', spaceId: 's-1', name: 'ガイドライン', color: '#1d4ed8', createdAt: '', updatedAt: '' },
      { id: 'l-2', spaceId: 's-1', name: '要更新', color: '#dbeafe', createdAt: '', updatedAt: '' },
    ],
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('ガイドライン')).toBeVisible();
    await expect(within(canvasElement).getByText('要更新')).toBeVisible();
  },
};

/** ラベルが無ければチップ自体を出さない（バッジ・統計だけが残る）。 */
export const ラベルなし: Story = {
  args: { labels: [] },
};

/** 閲覧数・読了時間（段 2）。段 2 が未マージ（値が渡らない）ならこの行自体を出さない。 */
export const 閲覧数と読了時間: Story = {
  args: { viewCount: 128, readMinutes: 4 },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('閲覧 128')).toBeVisible();
    await expect(within(canvasElement).getByText('読了 4 分')).toBeVisible();
  },
};

/** 段 2 が未マージのとき（viewCount/readMinutes が渡らない）。閲覧・読了は出ない。 */
export const 閲覧数と読了時間が無い: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByText(/閲覧/)).toBeNull();
    await expect(within(canvasElement).queryByText(/読了/)).toBeNull();
  },
};

/**
 * 保存状態。読み上げ用の領域（role=status）は最初から置き、変わったときにだけ文字を入れる
 * （本文の末尾に置くと長いページで見えないので、バイラインに常置する）。
 */
export const 保存状態_保存済み: Story = {
  args: { saveStatus: 'saved' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status', { name: '保存状態' })).toHaveTextContent('保存済み');
  },
};

export const 保存状態_未保存: Story = {
  args: { saveStatus: 'unsaved' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status', { name: '保存状態' })).toHaveTextContent('未保存');
  },
};

/** まだ書き換えていない（idle）。領域はあるが文字は入っていない。 */
export const 保存状態_変更なし: Story = {
  args: { saveStatus: 'idle' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status', { name: '保存状態' })).toHaveTextContent('');
  },
};

/** 読むだけの人。書ける人と見え方がほぼ同じなので、書けないことを言葉で示す。 */
export const 閲覧のみ: Story = {
  args: { access: 'view' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('閲覧のみ')).toBeVisible();
    await expect(within(canvasElement).queryByRole('status')).toBeNull();
  },
};

/** コメントはできるが本文は編集できない人。 */
export const コメント可: Story = {
  args: { access: 'comment' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('コメント可')).toBeVisible();
  },
};
