import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import KbVersionsPanel from './KbVersionsPanel';
import type { KbPageVersion } from '@/entities/kb';

/**
 * 履歴パネルの中身（版を残すフォーム + 一覧、新しい順）。
 *
 * 状態は受け取るだけで、自分では取りに行かない（取得は useKbPageVersions が持つ）。
 * KbCommentsPanel と同じ流儀 — 読み込み中・空・失敗の見た目をここにそのまま並べられる。
 *
 * **読むことは canEdit に関わらず誰でもできる。**「版を残す」フォームだけが
 * canEdit の人に限られる。
 */
const meta = {
  title: 'pages/kb/KbVersionsPanel',
  component: KbVersionsPanel,
  parameters: { layout: 'padded' },
  args: {
    versions: [],
    loading: false,
    error: null,
    canEdit: true,
    selectedSeq: null,
    onCreateVersion: fn(async () => {}),
    onSelectVersion: fn(),
  },
  decorators: [
    (Story) => (
      <div className="w-80 bg-[var(--color-nav)]">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbVersionsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const version = (seq: number, note: string | null = null): KbPageVersion => ({
  seq,
  author: { userId: 1, name: '田中 太郎' },
  note,
  createdAt: '2026-09-01T10:30:00Z',
});

/** まだ 1 件も無い。編集できる人には「版を残す」ボタンが上に出る。 */
export const 空: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('まだ版がありません。')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '版を残す' })).toBeVisible();
  },
};

/** 読み込み中。件数が分からないのでスケルトンを 2 行出す。フォームは重ねない。 */
export const 読み込み中: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status', { name: '履歴を読み込み中' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: '版を残す' })).not.toBeInTheDocument();
  },
};

/** 失敗。 */
export const 失敗: Story = {
  args: {
    error: '履歴を読み込めませんでした。通信が切れたか、このページを見る立場でなくなっています。',
    onRetry: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent('履歴を読み込めませんでした');
    // 行き止まりにせず、その場で取り直せる。
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(args.onRetry).toHaveBeenCalled();
  },
};

/** 一覧が並ぶ（新しい順）。note があれば併記する。 */
export const 一覧: Story = {
  args: {
    versions: [version(3, 'リリース前の状態'), version(2), version(1, '初版')],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const items = canvas.getAllByRole('button', { name: /田中 太郎/ });
    // 「版を残す」ボタンは含めず、行だけを見る。
    expect(items).toHaveLength(3);
    await expect(canvas.getByText('リリース前の状態')).toBeVisible();
    await expect(canvas.getByText('初版')).toBeVisible();
  },
};

/** 行をクリックすると onSelectVersion(seq) が呼ばれる。 */
export const 行クリックで選択: Story = {
  args: {
    versions: [version(3), version(2)],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByRole('button', { name: /田中 太郎/ });
    await userEvent.click(rows[1]);
    await expect(args.onSelectVersion).toHaveBeenCalledWith(2);
  },
};

/** プレビュー中の版はハイライトされる（aria-current）。 */
export const 選択中の行はハイライト: Story = {
  args: {
    versions: [version(3), version(2)],
    selectedSeq: 2,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rows = canvas.getAllByRole('button', { name: /田中 太郎/ });
    await expect(rows[1]).toHaveAttribute('aria-current', 'true');
    await expect(rows[0]).not.toHaveAttribute('aria-current');
  },
};

/** 編集権限が無い人には「版を残す」フォームは出ない。読むこと自体はできる。 */
export const 編集権限が無い人には版を残すフォームが出ない: Story = {
  args: { versions: [version(1)], canEdit: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '版を残す' })).not.toBeInTheDocument();
    await expect(canvas.getAllByText('田中 太郎').length).toBeGreaterThan(0);
  },
};

/** 「版を残す」を開いて、メモを付けて送信する。成功したらフォームが閉じる。 */
export const 版を残すフォームの送信: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '版を残す' }));

    const textarea = canvas.getByPlaceholderText('メモ（任意）');
    await userEvent.type(textarea, 'リリース前の状態');
    // 「版を残す」というテキストのボタンが 2 つ（見出し配下の submit と、開く前のトグル。
    // トグルはこの時点で消えているので、フォーム内の送信ボタンだけが残る）。
    await userEvent.click(canvas.getByRole('button', { name: '版を残す' }));

    await expect(args.onCreateVersion).toHaveBeenCalledWith('リリース前の状態');
    // 送信できたらフォームが閉じ、トグルボタンに戻る。
    await expect(canvas.queryByPlaceholderText('メモ（任意）')).not.toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: '版を残す' })).toBeVisible();
  },
};

/** メモを空のまま送信してもよい（無記名の版）。 */
export const メモなしでも版を残せる: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '版を残す' }));
    await userEvent.click(canvas.getByRole('button', { name: '版を残す' }));

    await expect(args.onCreateVersion).toHaveBeenCalledWith(undefined);
  },
};

/** 送信に失敗したら、フォームは開いたままエラーを出す（入力は消えない）。 */
export const 版を残すのに失敗: Story = {
  args: {
    onCreateVersion: fn(async () => {
      throw new Error('network error');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '版を残す' }));
    const textarea = canvas.getByPlaceholderText('メモ（任意）');
    await userEvent.type(textarea, '消えてほしくない下書き');
    await userEvent.click(canvas.getByRole('button', { name: '版を残す' }));

    await expect(await canvas.findByRole('alert')).toHaveTextContent('版を残せませんでした');
    await expect(textarea).toHaveValue('消えてほしくない下書き');
  },
};
