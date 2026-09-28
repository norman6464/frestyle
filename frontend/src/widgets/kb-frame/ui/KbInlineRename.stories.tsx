import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fireEvent, fn, userEvent, waitFor, within } from 'storybook/test';
import KbInlineRename from './KbInlineRename';

/**
 * 行の題名をその場で書き換える入力欄。
 *
 * Enter で確定、Escape で取り消し、フォーカスが外れたときも確定する。
 *
 * **確定に失敗したら閉じない。** 閉じると、書いた文字は消えるのに元の題名が残り、
 * 「保存されたのか分からない」状態になる。開いたままにして、もう一度試せるようにする。
 *
 * 空の題名にはできない（サーバーも弾く）。変えずに確定したときは、何も投げずに閉じるだけ。
 */
const meta = {
  title: 'widgets/kb-frame/KbInlineRename',
  component: KbInlineRename,
  parameters: { layout: 'padded' },
  args: { initialTitle: '設計メモ', onCommit: fn(async () => {}), onCancel: fn() },
  decorators: [
    (Story) => (
      <div className="flex w-64 bg-surface-1 p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbInlineRename>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 開いた直後。いまの題名が入っていて、全部選ばれている（すぐ打ち替えられる）。 */
export const 開いた直後: Story = {
  args: {},
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'ページの題名' });
    await expect(input).toHaveValue('設計メモ');
    await expect(input).toHaveFocus();
  },
};

/** スペースの改名に使うとき。読み上げの名前が変わる。 */
export const スペースの改名: Story = {
  args: { initialTitle: '営業定例', ariaLabel: 'スペースの名前' },
  play: async ({ canvasElement }) => {
    await expect(
      within(canvasElement).getByRole('textbox', { name: 'スペースの名前' }),
    ).toBeInTheDocument();
  },
};

/** 打ち替えて Enter。前後の空白は落として渡す。 */
export const 打ち替えて確定: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'ページの題名' });
    await userEvent.clear(input);
    await userEvent.type(input, '  設計メモ（改訂）  {Enter}');
    await expect(args.onCommit).toHaveBeenCalledWith('設計メモ（改訂）');
  },
};

/**
 * 日本語入力の変換確定 Enter では確定しない。変換のたびに打ちかけの題名でリネームが
 * 飛んでいた不具合（isComposing / keyCode 229 を見ていなかった）の回帰確認。
 */
export const 変換中のEnterでは確定しない: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'ページの題名' });
    await userEvent.clear(input);
    await userEvent.type(input, 'あいう');
    // 変換確定の Enter（isComposing=true）。userEvent.type の {Enter} は素の Enter しか
    // 送れないため、IME 変換中の値は fireEvent で直接組み立てる。
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    await expect(args.onCommit).not.toHaveBeenCalled();
    await expect(input).toHaveValue('あいう');

    // 変換が終わったあとの本当の Enter では確定する。
    fireEvent.keyDown(input, { key: 'Enter' });
    await expect(args.onCommit).toHaveBeenCalledWith('あいう');
  },
};

/** Escape で取り消し。確定は走らない。 */
export const 取り消す: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'ページの題名' });
    await userEvent.type(input, '{Escape}');
    await expect(args.onCancel).toHaveBeenCalled();
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/** 空にして確定しようとしたとき。投げずに閉じるだけ。 */
export const 空にはできない: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'ページの題名' });
    await userEvent.clear(input);
    await userEvent.type(input, '{Enter}');
    await expect(args.onCommit).not.toHaveBeenCalled();
    await expect(args.onCancel).toHaveBeenCalled();
  },
};

/** 変えずに確定したとき。要らない書き込みは投げない。 */
export const 変えなければ投げない: Story = {
  args: {},
  play: async ({ args, canvasElement }) => {
    await userEvent.type(
      within(canvasElement).getByRole('textbox', { name: 'ページの題名' }),
      '{Enter}',
    );
    await expect(args.onCommit).not.toHaveBeenCalled();
  },
};

/**
 * 保存に失敗したとき。**入力欄は開いたまま**で、書いた文字も残る。
 *
 * 失敗の作り方に注意: `fn().mockRejectedValue(...)` は使えない。Storybook が story ごとに
 * fn() を reset するため、あとから足した振る舞いが消える。`fn(実装)` の形で渡す。
 */
export const 失敗しても閉じない: Story = {
  args: {
    onCommit: fn(async () => {
      throw new Error('保存に失敗しました');
    }),
  },
  play: async ({ canvasElement }) => {
    const input = within(canvasElement).getByRole('textbox', { name: 'ページの題名' });
    await userEvent.clear(input);
    await userEvent.type(input, '新しい題名{Enter}');
    await waitFor(async () => {
      await expect(input).toHaveValue('新しい題名');
      await expect(input).toBeEnabled();
    });
  },
};
