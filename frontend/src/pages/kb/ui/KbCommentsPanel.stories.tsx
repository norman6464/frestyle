import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import KbCommentsPanel from './KbCommentsPanel';
import type { KbCommentThread } from '@/entities/kb';

/**
 * コメントパネルの中身。未解決を先に、解決済みを後に並べる。
 *
 * 状態は受け取るだけで、自分では取りに行かない（取得は useKbComments が持つ）。
 * そのため、読み込み中・空・失敗の見た目をここにそのまま並べられる。
 *
 * **読むことは canComment に関わらず誰でもできる。** 作成フォーム・返信欄・解決/再開の
 * ボタンだけが canComment が true の人に限られる。
 */
const meta = {
  title: 'pages/kb/KbCommentsPanel',
  component: KbCommentsPanel,
  parameters: { layout: 'padded' },
  args: {
    threads: [],
    loading: false,
    error: null,
    canComment: true,
    pendingAnchor: null,
    onCancelPendingAnchor: fn(),
    onCreateThread: fn(async () => {}),
    onReply: fn(async () => {}),
    onResolve: fn(async () => {}),
    onReopen: fn(async () => {}),
  },
  decorators: [
    (Story) => (
      <div className="w-80 bg-[var(--color-nav)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbCommentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const thread = (id: string, resolvedAt: string | null = null): KbCommentThread => ({
  id,
  createdBy: { userId: 1, name: '田中 太郎' },
  resolvedAt,
  resolvedBy: resolvedAt ? { userId: 2, name: '鈴木 花子' } : null,
  createdAt: '2026-09-01T10:00:00Z',
  comments: [
    {
      id: `${id}-c1`,
      author: { userId: 1, name: '田中 太郎' },
      body: [{ type: 'text', text: `${id} についてのコメント` }],
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-01T10:00:00Z',
    },
  ],
});

/** まだ 1 件も無い。コメントできる人には作成フォームが上に出る。 */
export const 空: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('まだコメントはありません。')).toBeVisible();
    await expect(canvas.getByPlaceholderText('コメントを書く…')).toBeVisible();
  },
};

/** 未解決・解決済みが混在。未解決が先に並ぶ。 */
export const 未解決と解決済みの分類: Story = {
  args: {
    threads: [thread('t-1'), thread('t-2', '2026-09-02T00:00:00Z'), thread('t-3')],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('未解決（2）')).toBeVisible();
    await expect(canvas.getByText('解決済み（1）')).toBeVisible();

    // 未解決の見出しが解決済みより先（DOM 順）に来る。
    const unresolvedHeading = canvas.getByText('未解決（2）');
    const resolvedHeading = canvas.getByText('解決済み（1）');
    expect(
      unresolvedHeading.compareDocumentPosition(resolvedHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  },
};

/** 新しいスレッドを作る。 */
export const スレッドを作成: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const textarea = canvas.getByPlaceholderText('コメントを書く…');
    await userEvent.type(textarea, '全体的にとても分かりやすいです');
    await userEvent.click(canvas.getByRole('button', { name: '送信' }));

    await expect(args.onCreateThread).toHaveBeenCalledWith([
      { type: 'text', text: '全体的にとても分かりやすいです' },
    ]);
  },
};

/** コメント権限が無い。読めるが、作成フォームは出ない。 */
export const コメントできない人には作成フォームが出ない: Story = {
  args: { threads: [thread('t-1')], canComment: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByPlaceholderText('コメントを書く…')).not.toBeInTheDocument();
    // 一覧そのものは見える（作成者名・コメント投稿者名の両方に出るので複数件ヒットする）。
    await expect(canvas.getAllByText('田中 太郎').length).toBeGreaterThan(0);
    await expect(canvas.queryByRole('button', { name: '解決' })).not.toBeInTheDocument();
  },
};

/**
 * 読み込み中。canComment=true でも作成フォームは出さない（最低限の防御として、
 * まだ読めていない一覧の上に新規作成を重ねさせない — CodeRabbit 指摘）。
 */
export const 読み込み中: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status', { name: 'コメントを読み込み中' })).toBeVisible();
    await expect(canvas.queryByPlaceholderText('コメントを書く…')).not.toBeInTheDocument();
  },
};

/**
 * 選択範囲からコメントを作る途中（バブルメニューの「コメント」経由）。
 * 引用文が出て、「新しいスレッドを作成」（page-level）フォームは隠れる。
 */
export const 選択範囲へコメント: Story = {
  args: {
    threads: [thread('t-1')],
    pendingAnchor: { blockId: 'block-1', anchorFrom: 6, anchorTo: 11, quote: '選んだ文章' },
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('選択範囲へコメント')).toBeVisible();
    await expect(canvas.getByText('選んだ文章')).toBeVisible();
    // page-level の作成フォームは隠れる（見出しが重複しない）。
    await expect(canvas.queryByText('新しいスレッドを作成')).not.toBeInTheDocument();

    // 「送信」ボタンは既存スレッドの返信欄にも出るので、この作成フォーム（textarea の
    // 直近の親）に絞って押す（複数ヒットの曖昧さを避ける）。
    const textarea = canvas.getByPlaceholderText('コメントを書く…');
    await userEvent.type(textarea, 'ここは要修正です');
    const composer = within(textarea.closest('div')!);
    await userEvent.click(composer.getByRole('button', { name: '送信' }));
    await expect(args.onCreateThread).toHaveBeenCalledWith(
      [{ type: 'text', text: 'ここは要修正です' }],
      { blockId: 'block-1', anchorFrom: 6, anchorTo: 11, quote: '選んだ文章' },
    );

    await userEvent.click(canvas.getByRole('button', { name: 'キャンセル' }));
    await expect(args.onCancelPendingAnchor).toHaveBeenCalled();
  },
};

/** 失敗。 */
export const 失敗: Story = {
  args: {
    error:
      'コメントを読み込めませんでした。通信が切れたか、このページを見る立場でなくなっています。開き直すと最新の状態が出ます。',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent(/コメントを読み込めませんでした/);
  },
};
