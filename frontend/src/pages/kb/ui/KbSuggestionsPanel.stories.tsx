import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import KbSuggestionsPanel from './KbSuggestionsPanel';
import type { KbPageSuggestion } from '@/entities/kb';

/**
 * 「提案」パネルの中身。状態は受け取るだけで、自分では取りに行かない
 * （取得は useKbPageSuggestions が持つ）。一覧は open な提案だけ（backend が既に絞って返す）。
 *
 * 差分は doc と baseDoc をこちら側で突き合わせて計算する。採用・却下は canEdit のときだけ
 * ボタンが出る（読むこと自体は canView だけで誰でもできる）。
 */
const meta = {
  title: 'pages/kb/KbSuggestionsPanel',
  component: KbSuggestionsPanel,
  parameters: { layout: 'padded' },
  args: {
    suggestions: [],
    loading: false,
    error: null,
    canEdit: true,
    onAccept: fn(async () => {}),
    onReject: fn(async () => {}),
  },
  decorators: [
    (Story) => (
      <div className="w-96 bg-[var(--color-nav)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbSuggestionsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: '元の本文' }] }],
};

const suggestion = (id: string, over: Partial<KbPageSuggestion> = {}): KbPageSuggestion => ({
  id,
  baseSeq: 3,
  baseDoc,
  doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '書き換え後の本文' }] }] },
  status: 'open',
  author: { userId: 1, name: '鈴木 花子' },
  createdAt: '2026-09-01T10:30:00Z',
  ...over,
});

/** まだ 1 件も無い。 */
export const 空: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('まだ提案はありません。')).toBeVisible();
  },
};

/** 読み込み中。件数が分からないのでスケルトンを 2 行出す。 */
export const 読み込み中: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('status', { name: '提案を読み込み中' }),
    ).toBeVisible();
  },
};

/** 失敗。 */
export const 失敗: Story = {
  args: {
    error: '提案を読み込めませんでした。通信が切れたか、このページを見る立場でなくなっています。',
    onRetry: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('提案を読み込めませんでした');
    // 行き止まりにせず、その場で取り直せる。
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/**
 * 一覧が並ぶ。提案者名・作成日時・差分（追加=緑・削除=赤の打ち消し線）が見える。
 * 追加・削除は色だけで伝えない — "+"/"-" の記号と、スクリーンリーダー向けの
 * ラベル（追加:/削除:）も併記する。
 */
export const 一覧と差分: Story = {
  args: { suggestions: [suggestion('s-1')] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('鈴木 花子')).toBeVisible();
    await expect(canvas.getByText('元の本文')).toHaveClass(/line-through/);
    await expect(canvas.getByText('書き換え後の本文')).toBeVisible();
    await expect(canvas.getByText('追加:')).toBeInTheDocument();
    await expect(canvas.getByText('削除:')).toBeInTheDocument();
  },
};

/**
 * 差分の行数（KbSuggestionDiffView の描画上限）が大きすぎるときは、行を間引いて一部だけ
 * 見せるのではなく、丸ごと「表示できません」に切り替える。一部だけ見せると、間引かれた
 * 側に紛れ込んだ変更（リンクの差し替え等）が採用者から見えなくなるため。
 */
export const 差分行数が多すぎると代替表示になる: Story = {
  args: {
    suggestions: [
      suggestion('s-1', {
        baseDoc: {
          type: 'doc',
          content: Array.from({ length: 5 }, (_, i) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: `元の行${i}` }],
          })),
        },
        doc: {
          type: 'doc',
          content: Array.from({ length: 600 }, (_, i) => ({
            type: 'paragraph',
            content: [{ type: 'text', text: `新しい行${i}` }],
          })),
        },
      }),
    ],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      canvas.getByText('差分が大きすぎるため表示できません。採用する前に本文を直接確認してください。'),
    ).toBeVisible();
    await expect(canvas.queryByText('元の行0')).not.toBeInTheDocument();
  },
};

/** baseSeq が無い（まだ版が1つも無いページへの提案）は追加行だけの差分になる。 */
export const 版がまだ無いページへの提案: Story = {
  args: {
    suggestions: [suggestion('s-1', { baseSeq: undefined, baseDoc: undefined })],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('書き換え後の本文')).toBeVisible();
    await expect(canvas.queryByText('元の本文')).not.toBeInTheDocument();
  },
};

/** 編集権限が無い人には採用・却下ボタンが出ない。読むこと自体はできる。 */
export const 編集権限が無い人には採用却下ボタンが出ない: Story = {
  args: { suggestions: [suggestion('s-1')], canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('鈴木 花子')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '採用' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: '却下' })).not.toBeInTheDocument();
  },
};

/** 採用を押すと onAccept が呼ばれる。確認ダイアログは無い（楽観的に呼ぶ）。 */
export const 採用を押す: Story = {
  args: { suggestions: [suggestion('s-1')] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '採用' }));
    await expect(args.onAccept).toHaveBeenCalledWith('s-1');
  },
};

/** 却下を押すと onReject が呼ばれる。 */
export const 却下を押す: Story = {
  args: { suggestions: [suggestion('s-1')] },
  play: async ({ args, canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '却下' }));
    await expect(args.onReject).toHaveBeenCalledWith('s-1');
  },
};

/**
 * 1件の採用が飛んでいる間、他の提案の採用・却下ボタンも押せなくする（同時に2件の採用が
 * 走ると、片方が丸ごとの本文置換で先勝ちの結果を消してしまうため）。押している行自体は
 * loading 表示、他の行は disabled で見分ける。
 */
export const 採用が飛んでいる間は他の提案の操作も押せない: Story = {
  args: {
    suggestions: [suggestion('s-1'), suggestion('s-2', { author: { userId: 2, name: '田中 太郎' } })],
    onAccept: fn(() => new Promise<void>(() => {})), // 決して解決しない = ずっと飛んでいる状態を固定する
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const acceptButtons = canvas.getAllByRole('button', { name: '採用' });
    const rejectButtons = canvas.getAllByRole('button', { name: '却下' });
    await userEvent.click(acceptButtons[0]);

    await expect(acceptButtons[0]).toBeDisabled();
    await expect(rejectButtons[0]).toBeDisabled();
    await expect(acceptButtons[1]).toBeDisabled();
    await expect(rejectButtons[1]).toBeDisabled();
  },
};

/** 採用に失敗しても、この部品自体は何も表示しない（知らせは呼び出し側 KbPage のトーストが担う）。 */
export const 採用に失敗しても押し直せる: Story = {
  args: {
    suggestions: [suggestion('s-1')],
    onAccept: fn(async () => {
      throw new Error('conflict');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const acceptButton = canvas.getByRole('button', { name: '採用' });
    await userEvent.click(acceptButton);
    await expect(acceptButton).toBeEnabled();
  },
};
