import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import type { PageRefCandidate } from './pageRefSuggestion';
import type { RichDocContent } from '@/shared/lib/richDoc';

/**
 * `[[` に続けて題名を打つと、ページの候補が出る。Enter（またはクリック）で選ぶと、
 * 打ちかけの `[[題名` が消えてページ参照が入る。候補が出ている間の Enter は確定で、改行にならない。
 *
 * 候補は画面側が渡す検索の口から取る（この見本では手元の一覧を題名で絞る）。
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/PageRefSuggestion',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const PAGES: PageRefCandidate[] = [
  { id: 'a1b2c3d4-0000-4000-8000-000000000001', title: '設計ノート' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000002', title: '設計の決めごと' },
  { id: 'a1b2c3d4-0000-4000-8000-000000000003', title: '議事録 2026-10' },
];

const searchPages = async (query: string) => PAGES.filter((page) => page.title.includes(query));

function Harness() {
  // 空の本文から始める（押した場所にカーソルが入り、そこから打てる。user-event の {End} は
  // contenteditable では使えない）。
  const [value, setValue] = useState<RichDocContent>({ type: 'doc', content: [{ type: 'paragraph' }] });
  return (
    <div className="max-w-2xl">
      <RichTextEditor value={value} editable onChange={setValue} ariaLabel="本文" searchPages={searchPages} />
    </div>
  );
}

/** `[[設計` と打つと候補が 2 件出る。 */
export const 候補が出る: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole('textbox', { name: '本文' });
    await userEvent.click(textbox);
    // user-event のキー入力では `[` が特別な文字なので、`[[` と二重にして 1 つの `[` を打つ。
    await userEvent.keyboard('[[[[設計');
    const listbox = await within(document.body).findByRole('listbox', { name: 'ページの候補' });
    await expect(listbox).toHaveTextContent('設計ノート');
    await expect(listbox).toHaveTextContent('設計の決めごと');
  },
};

/** 候補が出ているときの Enter は改行ではなく確定。ページ参照が入り、打ちかけは消える。 */
export const Enterで選ぶ: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole('textbox', { name: '本文' });
    await userEvent.click(textbox);
    await userEvent.keyboard('[[[[設計ノ');
    await within(document.body).findByRole('option', { name: '設計ノート' });
    await userEvent.keyboard('{Enter}');
    await waitFor(async () => {
      const ref = canvasElement.querySelector('a[data-page-ref]');
      await expect(ref).toHaveTextContent('設計ノート');
    });
    await expect(textbox).not.toHaveTextContent('[[');
    // 段落は 1 つのまま（Enter が改行にならない）。
    await expect(canvasElement.querySelectorAll('.ProseMirror > p')).toHaveLength(1);
  },
};
