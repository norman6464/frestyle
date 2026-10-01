import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import LinkFormatControl from './LinkFormatControl';
import { createEditorExtensions } from './editorExtensions';
import './richTextEditor.css';

/**
 * 選んだ文字にリンクを掛ける操作。書式のボタン列の末尾に置いてある。
 *
 * 他の書式（太字など）と違い、**人から URL を受け取る**必要があるので、この操作だけ
 * 専用の部品になっている。
 *
 * 受け付けるのは `http://` `https://` `mailto:` `tel:` で始まるものだけ。それ以外
 * （`javascript:` など）は弾く。押した人が意図しない動きをする URL を本文に残さないため。
 * 弾かれても入力欄は閉じない — 打ち直せるまま、何が悪かったのかを出す。
 */
/*
 * この部品は単体では立てられない（エディタ本体が要る）。args ではなく render の中で
 * 作るので、meta も satisfies ではなく注釈で受けて args を任意にする。
 */
const meta: Meta<typeof LinkFormatControl> = {
  title: 'pages/kb/editor/LinkFormatControl',
  component: LinkFormatControl,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof LinkFormatControl>;

const SAMPLE = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'ここにリンクを掛けます' }] },
  ],
};

/** 見本用の小さなエディタ。掛けた結果を本文で確かめられるようにする。 */
function LinkHarness() {
  const editor = useEditor({
    extensions: createEditorExtensions({}),
    content: SAMPLE,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': '本文' },
    },
    // 文字を選んでおく。選択が無いと、どこに掛けるのかが決まらない。
    onCreate: ({ editor: created }) => created.commands.selectAll(),
  });

  if (!editor) return null;

  return (
    <div className="max-w-2xl space-y-3">
      <div className="rte-bubble inline-flex">
        <LinkFormatControl editor={editor as Editor} />
      </div>
      <div className="rounded border border-surface-3 p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** 閉じているとき。鎖のボタンだけが見える。 */
export const 閉じている: Story = {
  render: () => <LinkHarness />,
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('button', { name: 'リンク' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  },
};

/** 押して入力欄を開いたところ。 */
export const 開いたところ: Story = {
  render: () => <LinkHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'リンク' }));
    await expect(canvas.getByRole('textbox', { name: 'リンク先 URL' })).toBeVisible();
  },
};

/** URL を入れて適用すると、本文にリンクが掛かる。 */
export const 掛けたところ: Story = {
  render: () => <LinkHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'リンク' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'リンク先 URL' }), 'https://go.dev/');
    await userEvent.click(canvas.getByRole('button', { name: '適用' }));
    await waitFor(async () => {
      await expect(canvasElement.querySelector('a[href="https://go.dev/"]')).not.toBeNull();
    });
  },
};

/** 受け付けない URL を入れたとき。閉じずに理由を出す。 */
export const 受け付けないURL: Story = {
  render: () => <LinkHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'リンク' }));
    const input = canvas.getByRole('textbox', { name: 'リンク先 URL' });
    await userEvent.type(input, 'javascript:alert(1)');
    await userEvent.click(canvas.getByRole('button', { name: '適用' }));
    await expect(await canvas.findByRole('alert')).toBeVisible();
    // 打ち直せるよう、入力はそのまま残る。
    await expect(input).toHaveValue('javascript:alert(1)');
  },
};
