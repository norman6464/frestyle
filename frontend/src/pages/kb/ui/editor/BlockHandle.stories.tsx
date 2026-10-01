import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';

/**
 * ブロックの取っ手。本文のブロックにマウスを乗せると、左の余白にそのブロックの高さで出る。
 *
 * - つかんで動かすと並べ替え（ドラッグは見本では動かせないので、手で試す）
 * - 押すと小さなメニュー: 上へ移動・下へ移動・複製・削除
 * - キーボードでは Alt+↑ / Alt+↓ で、カーソルのあるブロックが動く（取っ手に触れなくてよい）
 *
 * 動くのは常に「いちばん外」のブロック（リストの項目や表のセルの中にカーソルがあっても、
 * リスト全体・表全体が動く）。
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/BlockHandle',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });

const SAMPLE: RichDocContent = {
  type: 'doc',
  content: [
    paragraph('一つ目の段落。ブロックに乗せると左に取っ手が出ます。'),
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [paragraph('リストは全体で 1 つのブロック')] },
        { type: 'listItem', content: [paragraph('項目の中にカーソルがあっても、動くのはリスト全体')] },
      ],
    },
    paragraph('三つ目の段落。'),
  ],
};

/** 見本用。本文の変更を手元の state で受けて描き直す。 */
function HandleHarness({ editable = true }: { editable?: boolean }) {
  const [value, setValue] = useState<RichDocContent>(SAMPLE);
  return (
    <div className="max-w-2xl pl-10">
      <RichTextEditor value={value} editable={editable} onChange={setValue} ariaLabel="本文" />
    </div>
  );
}

/** 本文のブロックに乗せると取っ手が出る。乗せる前は無い。 */
export const 乗せると出る: Story = {
  render: () => <HandleHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('三つ目の段落。');
    await expect(canvas.queryByRole('button', { name: 'ブロックの操作' })).toBeNull();
    await userEvent.hover(canvas.getByText('三つ目の段落。'));
    await expect(await canvas.findByRole('button', { name: 'ブロックの操作' })).toBeVisible();
  },
};

/** 取っ手を押すとメニューが開く。いちばん下のブロックでは「下へ移動」が押せない。 */
export const メニュー: Story = {
  render: () => <HandleHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(await canvas.findByText('三つ目の段落。'));
    await userEvent.click(await canvas.findByRole('button', { name: 'ブロックの操作' }));
    const menu = await canvas.findByRole('menu', { name: 'ブロックの操作' });
    await expect(within(menu).getByRole('menuitem', { name: '上へ移動' })).toBeEnabled();
    await expect(within(menu).getByRole('menuitem', { name: '下へ移動' })).toBeDisabled();
    await expect(within(menu).getByRole('menuitem', { name: '複製' })).toBeEnabled();
    await expect(within(menu).getByRole('menuitem', { name: 'ブロックを削除' })).toBeEnabled();
  },
};

/** メニューの「複製」で同じブロックが直後に入り、メニューは閉じる。 */
export const 複製: Story = {
  render: () => <HandleHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(await canvas.findByText('三つ目の段落。'));
    await userEvent.click(await canvas.findByRole('button', { name: 'ブロックの操作' }));
    await userEvent.click(await canvas.findByRole('menuitem', { name: '複製' }));
    await waitFor(async () => expect(canvas.getAllByText('三つ目の段落。')).toHaveLength(2));
    await expect(canvas.queryByRole('menu', { name: 'ブロックの操作' })).toBeNull();
  },
};

/** Alt+↑ で、カーソルのあるブロック（リストの中でもリスト全体）が上へ動く。Escape でメニューを閉じると本文へ焦点が戻る。 */
export const キーボード: Story = {
  render: () => <HandleHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole('textbox', { name: '本文' });
    await userEvent.click(canvas.getByText('リストは全体で 1 つのブロック'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await waitFor(async () => {
      const pm = canvasElement.querySelector('.ProseMirror');
      await expect(pm?.children[0]?.tagName).toBe('UL');
    });

    await userEvent.hover(canvas.getByText('三つ目の段落。'));
    await userEvent.click(await canvas.findByRole('button', { name: 'ブロックの操作' }));
    await canvas.findByRole('menu', { name: 'ブロックの操作' });
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => expect(canvas.queryByRole('menu', { name: 'ブロックの操作' })).toBeNull());
    await expect(textbox).toHaveFocus();
  },
};

/** 読み取り専用では取っ手を出さない。 */
export const 読み取り専用: Story = {
  render: () => <HandleHarness editable={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.hover(await canvas.findByText('三つ目の段落。'));
    await expect(canvas.queryByRole('button', { name: 'ブロックの操作' })).toBeNull();
  },
};
