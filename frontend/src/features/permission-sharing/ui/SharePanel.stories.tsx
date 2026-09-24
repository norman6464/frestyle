import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SharePanel from './SharePanel';
import type { ShareRow } from '../model/types';

/**
 * 対象ごとの共有パネル（いまはナレッジのページで使う）。設計の記録は
 * https://claude.ai/code/artifact/7a173249-210b-4042-8bc4-d24ccacd303c
 *
 * いちばん大事なのは **出さないものの扱い**。一覧に並ぶのはこのページ自身に張った行だけで、
 * 上の段（ワークスペース / スペース / 祖先のページ）から届いている人は入らない。
 * 何も書かないと「このページを見られる人の一覧」に読め、空を「誰も見られない」と
 * 取り違えたまま機密が書き込まれる。だから**どの状態でもそのことを本文で言う** —
 * 行があるときは見出しの下の注記が、空のときはそれより強い一文が受け持つ
 * （似た文を 2 つ並べると、どちらも読み飛ばされる）。
 */
const meta = {
  title: 'features/permission-sharing/SharePanel',
  component: SharePanel,
  parameters: { layout: 'centered' },
  args: {
    targetTitle: '設計メモ / 権限モデル',
    inheritedNote: '上の段（ワークスペース・スペース・親ページ）から届いている人はここには出ません。',
    emptyNote:
      'ここではまだ誰にも権限を足していません。上の段から届いている人は、ここが空でもこれを見られます。',
    rows: [],
    candidates: [],
    loading: false,
    error: null,
    saving: false,
    // 成功可否を返す契約（失敗したときに選択を消さないため）。
    onGrant: fn(async () => true),
    onRevoke: fn(async () => true),
    onClose: fn(),
  },
} satisfies Meta<typeof SharePanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const ROWS: ShareRow[] = [
  { principalId: 'p-tanaka', role: 'editor', name: '田中 太郎', kind: 'user' },
  { principalId: 'p-all', role: 'viewer', name: '開発ナレッジ', kind: 'space_all' },
];

const CANDIDATES = [
  { id: 'p-suzuki', kind: 'user' as const, name: '鈴木 花子' },
  { id: 'p-dev', kind: 'group' as const, name: '開発チーム' },
];

/** 張った権限が 2 件。役割を変える・外すがそれぞれ 1 手で届く。 */
export const 通常: Story = {
  args: { rows: ROWS, candidates: CANDIDATES },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // 継承の注記は常に出る（この画面のいちばん大事な一文）。
    await expect(canvas.getByText(/上の段.*から届いている人はここには出ません/)).toBeVisible();

    // 役割を変えると、その相手と新しい役割で呼ばれ、結果がパネルの中に出る。
    await userEvent.selectOptions(canvas.getByLabelText('田中 太郎 の役割'), 'admin');
    await expect(args.onGrant).toHaveBeenCalledWith('p-tanaka', 'admin');
    await expect(await canvas.findByText('田中 太郎 を管理者にしました')).toBeVisible();

    // 外すのは確認を挟まない（取り消しは冪等で、間違えたらその場で足し直せる）。結果は出す。
    await userEvent.click(canvas.getByLabelText('田中 太郎 を外す'));
    await expect(args.onRevoke).toHaveBeenCalledWith('p-tanaka');
    await expect(await canvas.findByText('田中 太郎 を外しました')).toBeVisible();
  },
};

/**
 * 相手を選ぶまで「追加」は押せない。選ぶと押せるようになり、選んだ相手と役割で呼ばれる。
 */
export const 相手を足す: Story = {
  args: { rows: ROWS, candidates: CANDIDATES },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const add = canvas.getByRole('button', { name: '追加' });
    await expect(add).toBeDisabled();

    await userEvent.selectOptions(canvas.getByLabelText('足す相手'), 'p-dev');
    await userEvent.selectOptions(canvas.getByLabelText('与える役割'), 'commenter');
    await expect(add).toBeEnabled();

    await userEvent.click(add);
    await expect(args.onGrant).toHaveBeenCalledWith('p-dev', 'commenter');
  },
};

/**
 * まだ誰にも足していない状態。**黙って空欄にしない。**
 * 空が「誰も見られない」に読まれるのがこの画面でいちばん危ない読み違いなので、
 * ここが空でも上の段から見えている人が居ることを本文で言う。
 */
export const まだ誰も足していない: Story = {
  args: { rows: [], candidates: CANDIDATES },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 空の一文は呼び出し側が渡す（段の呼び名が対象で違うため）。
    // ここで見たいのは「空でも黙って空欄にしない」こと。
    await expect(canvas.getByText(/ここが空でもこれを見られます/)).toBeVisible();
  },
};

/**
 * 名前を引けなかった相手（引いた直後に主体が消えた等）。
 * **行は落とさず ID で出す。** 消すと、取り消せない権限が画面から見えないまま残る。
 */
export const 名前が引けない相手: Story = {
  args: {
    rows: [
      { principalId: '0198a000-0000-7000-8000-00000000dead', role: 'editor', name: '', kind: 'unknown' },
    ],
    candidates: CANDIDATES,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 名前の代わりに ID が出て、外すボタンもその ID で引ける（＝ 消せる）。
    await expect(canvas.getByText('0198a000-0000-7000-8000-00000000dead')).toBeVisible();
    await expect(
      canvas.getByLabelText('0198a000-0000-7000-8000-00000000dead を外す'),
    ).toBeEnabled();
    await expect(canvas.getByText('不明な相手')).toBeVisible();
  },
};

/** 読み込み中。件数は分からないので 2 行に固定する（高さが跳ねない）。 */
export const 読み込み中: Story = {
  args: { loading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('status', { name: '権限を読み込み中' })).toBeVisible();
  },
};

/** 失敗。何が起きたかと、次にどうするかを書く。 */
export const 失敗: Story = {
  args: {
    error:
      '権限を読めませんでした。通信が切れたか、このページの権限を変える立場でなくなっています。開き直すと最新の状態が出ます。',
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('alert')).toHaveTextContent(/権限を読めませんでした/);
  },
};

/** 書き込み中は操作を止める（二重に送らない）。 */
export const 書き込み中: Story = {
  args: { rows: ROWS, candidates: CANDIDATES, saving: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('田中 太郎 の役割')).toBeDisabled();
    await expect(canvas.getByLabelText('田中 太郎 を外す')).toBeDisabled();
    await expect(canvas.getByLabelText('足す相手')).toBeDisabled();
  },
};
