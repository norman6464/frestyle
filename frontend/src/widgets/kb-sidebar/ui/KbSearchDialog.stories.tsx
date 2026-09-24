import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent, waitFor } from 'storybook/test';
import type { KbSpace } from '@/entities/kb';
import { withApi, withRouter } from '../../../../.storybook/decorators';
import KbSearchDialog from './KbSearchDialog';

/**
 * ワークスペース全体から題名でページを探す窓。
 *
 * サイドバー本体は「場所（木）」を示すことに徹し、探すのはこの窓に分けてある。
 * 常設の入力欄を置くと、狭いサイドバーの中で木と結果が同じ面を取り合うことになる。
 *
 * 探すのはサーバー。返るのは木と同じ規則で見てよい現役のページだけで、
 * **検索だけ別の判定にしない**（別にすると、見えないはずのページが検索からだけ見える）。
 *
 * 打つたびに投げず 250 ミリ秒待つ。速く打ったときに古い応答が新しい結果を上書きしないよう、
 * 世代番号で捨てている。
 */
const meta = {
  title: 'widgets/kb-sidebar/KbSearchDialog',
  component: KbSearchDialog,
  parameters: { layout: 'fullscreen' },
  args: { workspaceSlug: 'w-3f2a9c', onClose: fn() },
  decorators: [
    withRouter,
    (Story) => (
      <div className="min-h-[520px] bg-surface p-6">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbSearchDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const spaces: KbSpace[] = [
  {
    id: 's-1',
    key: 's-1a2b3c',
    name: 'バックエンド定例',
    visibility: 'workspace',
    createdAt: '2026-01-01T00:00:00Z',
  },
  {
    id: 's-2',
    key: 's-9d8c7b',
    name: '営業定例',
    visibility: 'private',
    createdAt: '2026-02-01T00:00:00Z',
  },
];

const page = (id: string, spaceId: string, title: string) => ({
  id,
  spaceId,
  title,
  createdByUserId: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
});

/** 開いた直後。まだ何も打っていない。 */
export const 開いた直後: Story = {
  decorators: [withApi({ '/search': [] })],
  args: { spaces },
  play: async () => {
    const input = screen.getByRole('combobox');
    // フォーカスは Dialog が中身を描いたあとに入力欄へ移す。
    await waitFor(async () => {
      await expect(input).toHaveFocus();
    });
  },
};

/** 見つかったとき。スペースごとに見出しを付けて並べる。 */
export const 見つかった: Story = {
  decorators: [
    withApi({
      '/search': [page('p-1', 's-1', '設計メモ'), page('p-2', 's-2', '設計レビューの進め方')],
    }),
  ],
  args: { spaces },
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByRole('combobox'), '設計');
    await waitFor(
      async () => {
        await expect(canvas.getByText('設計メモ')).toBeVisible();
      },
      { timeout: 5000 },
    );
    await expect(canvas.getByText('設計レビューの進め方')).toBeVisible();
  },
};

/** 本文一致の結果は、題名の下に抜粋を添え、一致箇所を <mark> で強調する。 */
export const 本文一致の抜粋と強調: Story = {
  decorators: [
    withApi({
      '/search': [
        {
          ...page('p-1', 's-1', '週次定例のメモ'),
          matchField: 'body',
          excerpt: '…この段落には docker の使い方が書かれている…',
          matchStart: 8,
          matchLen: 6,
        },
      ],
    }),
  ],
  args: { spaces },
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByRole('combobox'), 'docker');
    await waitFor(
      async () => {
        await expect(canvas.getByText('週次定例のメモ')).toBeVisible();
      },
      { timeout: 5000 },
    );
    // 一致箇所（"docker"）が <mark> で強調されている。
    const mark = document.body.querySelector('mark');
    await expect(mark).not.toBeNull();
    await expect(mark).toHaveTextContent('docker');
    // 抜粋の残りの文字列も（強調の前後に分かれて）そのまま読める。
    await expect(canvas.getByText(/この段落には/)).toBeVisible();
    await expect(canvas.getByText(/の使い方が書かれている/)).toBeVisible();
  },
};

/**
 * 抜粋に `<` `&` 等の HTML として解釈され得る文字が含まれていても、そのまま安全に
 * テキストとして描画される（dangerouslySetInnerHTML を使わず、React ノードとして
 * 分けて描画しているため、実際の HTML タグとしては解釈されない）。
 */
export const 抜粋にHTMLとして解釈され得る文字を含む: Story = {
  decorators: [
    withApi({
      '/search': [
        {
          ...page('p-1', 's-1', '条件分岐のメモ'),
          matchField: 'body',
          excerpt: '条件は a < b && c > d のとき成立する',
          matchStart: 4,
          matchLen: 5,
        },
      ],
    }),
  ],
  args: { spaces },
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByRole('combobox'), '条件分岐');
    await waitFor(
      async () => {
        await expect(canvas.getByText('条件分岐のメモ')).toBeVisible();
      },
      { timeout: 5000 },
    );
    const mark = document.body.querySelector('mark');
    await expect(mark).toHaveTextContent('a < b');
    // 実際の HTML タグとしては解釈されていない（余計な要素が生成されていない）。
    await expect(document.body.querySelector('script')).toBeNull();
    await expect(document.body.querySelectorAll('mark').length).toBe(1);
    await expect(canvas.getByText(/&& c > d/)).toBeVisible();
  },
};

/** 題名一致の結果には抜粋を出さない（matchField が "title"）。 */
export const 題名一致では抜粋を出さない: Story = {
  decorators: [
    withApi({
      '/search': [{ ...page('p-1', 's-1', '設計メモ'), matchField: 'title' }],
    }),
  ],
  args: { spaces },
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByRole('combobox'), '設計');
    await waitFor(
      async () => {
        await expect(canvas.getByText('設計メモ')).toBeVisible();
      },
      { timeout: 5000 },
    );
    await expect(document.body.querySelector('mark')).toBeNull();
  },
};

/** 絵文字のアイコンを設定したページは、結果でも絵文字で出る。 */
export const 結果に絵文字: Story = {
  decorators: [
    withApi({
      '/search': [{ ...page('p-1', 's-1', '設計メモ'), icon: { type: 'emoji', value: '📘' } }],
    }),
  ],
  args: { spaces },
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByRole('combobox'), '設計');
    await waitFor(
      async () => {
        await expect(canvas.getByText('設計メモ')).toBeVisible();
      },
      { timeout: 5000 },
    );
    const glyph = document.body.querySelector('[data-icon="emoji"]');
    await expect(glyph).not.toBeNull();
    await expect(glyph).toHaveTextContent('📘');
  },
};

/** 見つからなかったとき。空欄にせず、その旨を出す。 */
export const 見つからない: Story = {
  decorators: [withApi({ '/search': [] })],
  args: { spaces },
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByRole('combobox'), 'みつからない語');
    await waitFor(
      async () => {
        await expect(canvas.getByText('一致するページがありません')).toBeVisible();
      },
      { timeout: 5000 },
    );
  },
};

/** 探せなかったとき（通信の失敗）。黙って空にせず、もう一度試せるようにする。 */
export const 失敗したとき: Story = {
  // 見本に無い宛先は 404 を返すので、失敗の道筋がそのまま通る。
  decorators: [withApi({})],
  args: { spaces },
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByRole('combobox'), '設計');
    await waitFor(
      async () => {
        await expect(canvas.getByText('検索に失敗しました')).toBeVisible();
        await expect(canvas.getByRole('button', { name: '再試行' })).toBeVisible();
      },
      { timeout: 5000 },
    );
  },
};

/** Escape で閉じる。 */
export const Escapeで閉じる: Story = {
  decorators: [withApi({ '/search': [] })],
  args: { spaces },
  play: async ({ args }) => {
    await userEvent.type(screen.getByRole('combobox'), '{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** 閉じるボタンでも閉じられる（狭い画面には Esc キーが無い）。 */
export const 閉じるボタンで閉じる: Story = {
  decorators: [withApi({ '/search': [] })],
  args: { spaces },
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** 見つかった件数を読み上げに伝える。 */
export const 件数を読み上げる: Story = {
  decorators: [
    withApi({
      '/search': [page('p1', 's-1', '設計メモ')],
    }),
  ],
  args: { spaces },
  play: async () => {
    await userEvent.type(screen.getByRole('combobox'), '設計');
    await waitFor(
      async () => {
        await expect(screen.getByRole('status')).toHaveTextContent('1 件のページが見つかりました');
      },
      { timeout: 5000 },
    );
  },
};
