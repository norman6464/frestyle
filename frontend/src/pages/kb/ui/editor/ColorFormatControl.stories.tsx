import { useEffect } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor, JSONContent } from '@tiptap/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import ColorFormatControl from './ColorFormatControl';
import { createEditorExtensions } from './editorExtensions';
import { INLINE_MARK_COLORS, INLINE_MARK_COLOR_LABELS } from './inlineColors';
import './richTextEditor.css';

/**
 * 文字色・蛍光ペン。吹き出しの「色」を押すと、文字色と蛍光ペンの 8 色＋なしのパレットが開く。
 *
 * 色は名前だけを持ち、選べるのは決まった色だけ（自由な色は無い）。文字色は白地で読める濃さ、
 * 蛍光ペンは本文の文字がそのまま読める淡さにしてある。
 */
const meta: Meta<typeof ColorFormatControl> = {
  title: 'pages/kb/editor/ColorFormatControl',
  component: ColorFormatControl,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof ColorFormatControl>;

/** 8 色の文字色と蛍光ペンを並べた本文（見た目の確認用）。 */
const SAMPLE: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: INLINE_MARK_COLORS.flatMap((color, index) => [
        { type: 'text', text: `${INLINE_MARK_COLOR_LABELS[color]}の文字`, marks: [{ type: 'textStyle', attrs: { color } }] },
        { type: 'text', text: index === INLINE_MARK_COLORS.length - 1 ? '' : '　' },
      ]).filter((node) => node.text !== ''),
    },
    {
      type: 'paragraph',
      content: INLINE_MARK_COLORS.flatMap((color, index) => [
        { type: 'text', text: `${INLINE_MARK_COLOR_LABELS[color]}の蛍光ペン`, marks: [{ type: 'highlight', attrs: { color } }] },
        { type: 'text', text: index === INLINE_MARK_COLORS.length - 1 ? '' : '　' },
      ]).filter((node) => node.text !== ''),
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'この文を選んで、色を変えてみてください。' }] },
  ],
};

function ColorHarness({ selectLast = false }: { selectLast?: boolean }) {
  const editor = useEditor({
    extensions: createEditorExtensions({}),
    content: SAMPLE,
    editorProps: { attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': '本文' } },
  });
  useEffect(() => {
    if (!editor || !selectLast) return;
    const last = editor.state.doc.lastChild;
    if (!last) return;
    const from = editor.state.doc.content.size - last.nodeSize + 1;
    editor.commands.setTextSelection({ from, to: from + last.content.size });
  }, [editor, selectLast]);
  if (!editor) return null;
  return (
    <div className="max-w-2xl">
      <div role="toolbar" aria-label="書式メニュー" className="rte-bubble mb-3 inline-flex">
        <ColorFormatControl editor={editor as Editor} />
      </div>
      <div className="rte-content rounded border border-surface-3 p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** 8 色の文字色と蛍光ペンの見え方。 */
export const 見え方: Story = {
  render: () => <ColorHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('赤の文字')).toHaveAttribute('data-color', 'red');
    await expect(canvas.getByText('黄の蛍光ペン').tagName).toBe('MARK');
  },
};

/** 「色」を押すとパレットが開き、文字色の「赤」を押すと選んだ文に掛かる。 */
export const パレット: Story = {
  render: () => <ColorHarness selectLast />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '色' }));
    const text = await canvas.findByRole('group', { name: '文字色' });
    await userEvent.click(within(text).getByRole('button', { name: '赤' }));
    await waitFor(async () => {
      await expect(canvas.getByText('この文を選んで、色を変えてみてください。')).toHaveAttribute('data-color', 'red');
    });
    await expect(within(text).getByRole('button', { name: '赤' })).toHaveAttribute('aria-pressed', 'true');
  },
};
