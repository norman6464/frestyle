import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import NameCreateForm from './NameCreateForm';

/**
 * 「名前だけ」で何かを作る小さな入力欄（ワークスペース / スペース）。
 *
 * URL に出る短い名前は**人に決めさせない**。日本語の名前から作れず先へ進めなくなるし、
 * 他の人と同じ名前を選んで弾かれるのも人が踏むことになるため、サーバーが自動で決める。
 *
 * 失敗しても入力は消さない。消すと打ち直しになるうえ、何が悪かったのかも分からなくなる。
 */
const meta = {
  title: 'shared/NameCreateForm',
  component: NameCreateForm,
  parameters: { layout: 'centered' },
  args: { what: 'ワークスペース', onCreate: fn() },
  decorators: [
    (Story) => (
      // 実物と同じ、サイドバーの幅・地色で見る。
      <div className="w-64 bg-surface-1">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof NameCreateForm>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 空のとき。名前が無いうちはボタンを押せない。 */
export const 空: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('button', { name: 'ワークスペースを作る' }),
    ).toBeDisabled();
  },
};

/** 「スペース」を作る形。文言が「何を作るか」に合わせて変わる。 */
export const スペースを作る: Story = {
  args: { what: 'スペース' },
};

/** 名前を打つと押せるようになり、押すと名前だけが渡る。 */
export const 打って作る: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('ワークスペースの名前'), '開発チーム');
    const submit = canvas.getByRole('button', { name: 'ワークスペースを作る' });
    await expect(submit).toBeEnabled();
    await userEvent.click(submit);
    // 渡るのは名前だけ。URL 用の短い名前は入っていない。
    await expect(args.onCreate).toHaveBeenCalledWith({ name: '開発チーム' });
  },
};

/** 前後の空白は落として渡す。 */
export const 前後の空白は落とす: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText('ワークスペースの名前'), '  開発チーム  ');
    await userEvent.click(canvas.getByRole('button', { name: 'ワークスペースを作る' }));
    await expect(args.onCreate).toHaveBeenCalledWith({ name: '開発チーム' });
  },
};

/** 作れなかったとき。**入力はそのまま残る**（打ち直しにさせない）。 */
export const 失敗しても消えない: Story = {
  // 失敗の作り方に注意: `fn().mockRejectedValue(...)` は使えない。Storybook は story を
  // 切り替えるたびに fn() を reset するため、あとから足した振る舞いは消えて「成功」に戻る。
  // `fn(実装)` の形なら reset 後もその実装に戻るので、失敗が保たれる。
  args: {
    onCreate: fn(async () => {
      throw new Error('作成に失敗しました');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('ワークスペースの名前');
    await userEvent.type(input, '開発チーム');
    await userEvent.click(canvas.getByRole('button', { name: 'ワークスペースを作る' }));
    await waitFor(async () => {
      await expect(input).toHaveValue('開発チーム');
    });
  },
};

/** 開いた欄を閉じる手立て。「やめる」でも Esc でも閉じる（呼び出し側が onCancel を渡したとき）。 */
export const やめるで閉じる: Story = {
  args: { onCancel: fn(), autoFocus: true },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByLabelText('ワークスペースの名前')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await expect(args.onCancel).toHaveBeenCalledTimes(1);
    await userEvent.click(canvas.getByRole('button', { name: 'やめる' }));
    await expect(args.onCancel).toHaveBeenCalledTimes(2);
  },
};

/**
 * 一覧の上の帯に置く 1 行の形。見出しは読み上げにだけ残し、欄の中の薄い字で何の名前かを示す。
 * 幅が足りないと（この見本の 256px のように）ボタンは次の行へ回る。
 */
export const 一行に並べる: Story = {
  args: { what: 'スプリント', layout: 'inline', initialName: 'スプリント 3', onCancel: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('textbox', { name: 'スプリントの名前' })).toHaveValue('スプリント 3');
    await expect(canvas.getByRole('button', { name: 'スプリントを作る' })).toBeEnabled();
  },
};
