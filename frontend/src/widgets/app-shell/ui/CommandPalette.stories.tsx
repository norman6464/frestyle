import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, userEvent } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import CommandPalette from './CommandPalette';

/**
 * どこからでも開ける「行き先を探す窓」。
 *
 * 打つと候補が絞られ、上下キーで選び、Enter で移る。マウスを使わずに画面を移れるので、
 * ナビの位置を覚えていなくても目的地に着ける。
 *
 * 日本語のラベルだけでなく英語の別名（`kb` `wiki` など）でも引ける。ローマ字入力のまま
 * 打ち始める人が、いちいち変換しなくてよいようにしてある。
 *
 * 見つからないときは「該当するコマンドがありません」と出す。空欄にすると、
 * 壊れているのか一致が無いのか分からない。
 *
 * 窓は Base UI の Dialog で、body 直下（Portal）に描かれる。開いている間は Tab が窓の中だけを
 * 回り、閉じると開く前にフォーカスがあった場所へ戻る。入力欄は combobox で、上下キーで選んだ
 * 候補は aria-activedescendant で読み上げに伝わる。
 */
const meta = {
  title: 'widgets/app-shell/CommandPalette',
  component: CommandPalette,
  parameters: { layout: 'fullscreen' },
  args: { isOpen: true, onClose: fn() },
  decorators: [
    withRouter,
    (Story) => (
      <div className="min-h-[560px] bg-surface p-6">
        <p className="text-sm text-[var(--color-text-secondary)]">
          この後ろに画面があり、その上に窓が重なる。
        </p>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 開いた直後。全部の行き先が出る。 */
export const 開いたところ: Story = {
  play: async () => {
    const canvas = screen;
    await expect(canvas.getByPlaceholderText('移動先を探す...')).toBeVisible();
    await expect(canvas.getByText('ナレッジ')).toBeVisible();
  },
};

/** 閉じているとき。何も描かない。 */
export const 閉じている: Story = {
  args: { isOpen: false },
  play: async () => {
    await expect(screen.queryByPlaceholderText('移動先を探す...')).toBeNull();
  },
};

/** 打って絞り込んだところ。 */
export const 絞り込む: Story = {
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByPlaceholderText('移動先を探す...'), 'ナレッジ');
    await expect(canvas.getByText('ナレッジ')).toBeVisible();
    await expect(canvas.queryByText('ホーム')).toBeNull();
  },
};

/** 英語の別名でも引ける。 */
export const 英語でも引ける: Story = {
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByPlaceholderText('移動先を探す...'), 'wiki');
    await expect(canvas.getByText('ナレッジ')).toBeVisible();
  },
};

/** どれにも当たらないとき。 */
export const 該当なし: Story = {
  play: async () => {
    const canvas = screen;
    await userEvent.type(canvas.getByPlaceholderText('移動先を探す...'), 'zzzzzzz');
    await expect(canvas.getByText('該当するコマンドがありません')).toBeVisible();
  },
};

/** 上下キーで選ぶ。 */
export const キーボードで選ぶ: Story = {
  play: async () => {
    const canvas = screen;
    const input = canvas.getByPlaceholderText('移動先を探す...');
    await userEvent.type(input, '{ArrowDown}');
    const options = canvas.getAllByRole('option');
    await expect(options[1]).toHaveAttribute('aria-selected', 'true');
  },
};

/** Escape で閉じる。 */
export const Escapeで閉じる: Story = {
  play: async ({ args }) => {
    const input = screen.getByPlaceholderText('移動先を探す...');
    await userEvent.type(input, '{Escape}');
    await expect(args.onClose).toHaveBeenCalled();
  },
};

/** 窓として名乗り、入力欄は候補一覧を持つ combobox として名乗る。 */
export const 窓と候補の名乗り: Story = {
  play: async () => {
    await expect(screen.getByRole('dialog', { name: '移動先を探す' })).toBeVisible();
    const input = screen.getByRole('combobox', { name: '移動先を探す' });
    await expect(input).toHaveFocus();
    const listbox = screen.getByRole('listbox', { name: '移動先' });
    await expect(input).toHaveAttribute('aria-controls', listbox.id);
    await userEvent.keyboard('{ArrowDown}');
    const selected = screen.getAllByRole('option')[1];
    await expect(input).toHaveAttribute('aria-activedescendant', selected.id);
  },
};

/** マウスを乗せた候補に選択が合う（乗せた行と選択の行を別々に塗らない）。 */
export const マウスで選択が動く: Story = {
  play: async () => {
    const options = screen.getAllByRole('option');
    await userEvent.hover(options[2]);
    await expect(options[2]).toHaveAttribute('aria-selected', 'true');
    await expect(options[0]).toHaveAttribute('aria-selected', 'false');
  },
};

/** 絞り込んだ件数を読み上げに伝える。 */
export const 件数を読み上げる: Story = {
  play: async () => {
    await userEvent.type(screen.getByRole('combobox', { name: '移動先を探す' }), 'ナレッジ');
    await expect(screen.getByRole('status')).toHaveTextContent(/件の移動先/);
    await userEvent.clear(screen.getByRole('combobox', { name: '移動先を探す' }));
    await userEvent.type(screen.getByRole('combobox', { name: '移動先を探す' }), 'zzzzzzz');
    await expect(screen.getByRole('status')).toHaveTextContent('一致する移動先は 0 件です');
  },
};

/** 閉じるボタンでも閉じられる（狭い画面には Esc キーが無い）。 */
export const 閉じるボタンで閉じる: Story = {
  play: async ({ args }) => {
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};
