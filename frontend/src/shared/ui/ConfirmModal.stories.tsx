import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, screen, within } from 'storybook/test';
import ConfirmModal from './ConfirmModal';

/**
 * 確認モーダル。ブラウザ標準の confirm/alert の代わりに使う
 * （見た目が周りと揃い、文言とボタンの並びをこちらで統べられる）。
 * サイドバーのページ削除がこの部品で確かめる。
 */
const meta = {
  title: 'shared/ConfirmModal',
  component: ConfirmModal,
  parameters: { layout: 'fullscreen' },
  args: { onConfirm: fn(), onCancel: fn() },
} satisfies Meta<typeof ConfirmModal>;

export default meta;
type Story = StoryObj<typeof meta>;

/** サイドバーの「削除」で開く形。 */
export const ページの削除: Story = {
  args: {
    isOpen: true,
    title: 'ページを削除',
    message:
      '「ネスト2」を中のページごと削除します（アーカイブ済みの子ページも含みます）。元に戻せません。',
    confirmText: '削除',
    isDanger: true,
    icon: 'trash',
  },
  play: async ({ args, canvasElement }) => {
    // モーダルは document.body へポータルされるので canvasElement の中には無い
    // （呼び出し元の DOM に閉じ込めないための設計。ConfirmModal のコメント参照）。
    await expect(within(canvasElement).queryByRole('dialog')).toBeNull();

    const dialog = screen.getByRole('dialog', { name: 'ページを削除' });
    await expect(dialog).toBeInTheDocument();
    // 危険側のボタンを押すと onConfirm が 1 回だけ呼ばれる。
    (await within(dialog).findByRole('button', { name: '削除' })).click();
    await expect(args.onConfirm).toHaveBeenCalledOnce();
  },
};

/** 危険ではない確認（青いボタン側）。 */
export const 通常の確認: Story = {
  args: {
    isOpen: true,
    title: '確認',
    message: 'この内容で送信しますか？',
    confirmText: '送信',
    isDanger: false,
  },
};

/** 消すのではない危険な操作（外す・取り消す・停止）。赤いボタンだが、ごみ箱ではなく注意の印を出す。 */
export const 取り消し: Story = {
  args: {
    isOpen: true,
    title: '招待を取り消しますか？',
    message: 'taro@example.com 宛の招待を取り消します。送ったリンクは使えなくなります。',
    confirmText: '取り消す',
    isDanger: true,
  },
};

/** 何も指定しないとき。中立の「確定する」で、赤にもごみ箱にもならない。 */
export const 既定: Story = {
  args: {
    isOpen: true,
    message: 'この操作を続けますか？',
  },
  play: async () => {
    const dialog = screen.getByRole('dialog', { name: '確認' });
    await expect(within(dialog).getByRole('button', { name: '確定する' })).toBeVisible();
  },
};

/** 確定の処理中。両方のボタンを押せなくし、二重に送らない。 */
export const 処理中: Story = {
  args: {
    isOpen: true,
    title: 'スプリントを削除しますか？',
    message: '「スプリント 12」を削除します。中のチケットはバックログへ戻ります。',
    confirmText: '削除',
    isDanger: true,
    icon: 'trash',
    pending: true,
  },
  play: async () => {
    const dialog = screen.getByRole('dialog', { name: 'スプリントを削除しますか？' });
    await expect(within(dialog).getByRole('button', { name: '処理中…' })).toBeDisabled();
    await expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toBeDisabled();
  },
};
