import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import TableBubbleMenu from './TableBubbleMenu';
import { createEditorExtensions } from './editorExtensions';
import './richTextEditor.css';

/**
 * カーソルが表の中にあるときだけ、表の上端に浮かぶ操作の吹き出し。
 *
 * この部品が持つのは**どこに浮かべるか**だけで、中身のボタン列は TableMenuBar が担う。
 * 行・列の追加と削除、見出し行の切り替え、セルの結合と分割、表の削除。
 * 表の外へカーソルを動かすと消える。
 */
const meta: Meta<typeof TableBubbleMenu> = {
  title: 'pages/kb/editor/TableBubbleMenu',
  component: TableBubbleMenu,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof TableBubbleMenu>;

const cell = (type: 'tableHeader' | 'tableCell', text: string): JSONContent => ({
  type,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const SAMPLE: JSONContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '表の上の段落。ここにカーソルがあると吹き出しは出ません。' }] },
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', '項目'), cell('tableHeader', '値')] },
        { type: 'tableRow', content: [cell('tableCell', '行 1'), cell('tableCell', 'あ')] },
        { type: 'tableRow', content: [cell('tableCell', '行 2'), cell('tableCell', 'い')] },
      ],
    },
  ],
};

/**
 * 見本用の小さなエディタ。cursorAt の文字のところへカーソルを置いた状態から始める
 * （エディタができたあとの効果で置く。作成時に置くと初期化の途中で上書きされることがある）。
 */
function TableHarness({ cursorAt }: { cursorAt: string }) {
  const editor = useEditor({
    extensions: createEditorExtensions({}),
    content: SAMPLE,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': '本文' },
    },
  });
  useEffect(() => {
    if (!editor) return;
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found === -1 && node.isText && node.text === cursorAt) found = pos;
    });
    editor.commands.focus(found + 1);
  }, [editor, cursorAt]);

  if (!editor) return null;

  return (
    // 吹き出しは表の上に浮くので、上側に余白が無いと画面の外に出て見えない。
    <div className="max-w-2xl pt-16">
      <TableBubbleMenu editor={editor as Editor} />
      <div className="rte-content rounded border border-surface-3 p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** カーソルが表の外にあるとき。吹き出しは出ない。 */
export const 表の外: Story = {
  render: () => <TableHarness cursorAt="表の上の段落。ここにカーソルがあると吹き出しは出ません。" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('textbox', { name: '本文' });
    await expect(canvas.queryByRole('toolbar', { name: '表の操作' })).toBeNull();
  },
};

/** カーソルが表の中にあるとき。表の上端に吹き出しが浮かび、表の操作のボタンが出る。 */
export const 表の中: Story = {
  render: () => <TableHarness cursorAt="あ" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getByRole('toolbar', { name: '表の操作' })).toBeVisible();
      },
      { timeout: 5000 },
    );
    // 1 つのセルだけでは結合する相手も分かれるものも無いので押せない。
    await expect(canvas.getByRole('button', { name: 'セルを結合／分割' })).toBeDisabled();
  },
};

/** 「下に行を足す」を押すと、カーソルのある行の下に行が増える。 */
export const 行を足す: Story = {
  render: () => <TableHarness cursorAt="あ" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => expect(canvas.getByRole('toolbar', { name: '表の操作' })).toBeVisible(), { timeout: 5000 });
    await expect(canvasElement.querySelectorAll('tr')).toHaveLength(3);
    await userEvent.click(canvas.getByRole('button', { name: '下に行を足す' }));
    await waitFor(async () => expect(canvasElement.querySelectorAll('tr')).toHaveLength(4));
  },
};
