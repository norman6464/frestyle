import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import BubbleFormatMenu from './BubbleFormatMenu';
import { createEditorExtensions } from './editorExtensions';
import './richTextEditor.css';

/**
 * 文字を選んだときだけ浮かぶ、書式の吹き出し。
 *
 * この部品が持つのは**どこに浮かべるか**だけで、中身のボタン列は FormatMenuBar が担う。
 *
 * 画面上部に固定した帯を置かないのは、場所を取るわりに使うのが書式を変える一瞬だけだから。
 * 選んだときにその場に出るほうが、目も手も移動しない。
 */
/*
 * この部品は単体では立てられない（エディタ本体が要る）。args ではなく render の中で
 * 作るので、meta も satisfies ではなく注釈で受けて args を任意にする。
 */
const meta: Meta<typeof BubbleFormatMenu> = {
  title: 'pages/kb/editor/BubbleFormatMenu',
  component: BubbleFormatMenu,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof BubbleFormatMenu>;

const SAMPLE = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'この文を選ぶと、書式の吹き出しが浮かびます。' }],
    },
  ],
};

/** 見本用の小さなエディタ。selectAll で「選んだ状態」から始められる。 */
function BubbleHarness({ selectAll = false, editable = true }: { selectAll?: boolean; editable?: boolean }) {
  const editor = useEditor({
    extensions: createEditorExtensions({}),
    content: SAMPLE,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': '本文' },
    },
    onCreate: ({ editor: created }) => {
      if (selectAll) {
        created.commands.focus();
        created.commands.selectAll();
      }
    },
  });

  if (!editor) return null;

  return (
    // 吹き出しは選択の上に浮くので、上側に余白が無いと画面の外に出て見えない。
    <div className="max-w-2xl pt-24">
      <BubbleFormatMenu editor={editor as Editor} editable={editable} />
      <div className="rounded border border-surface-3 p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** 何も選んでいないとき。吹き出しは出ない。 */
export const 選んでいないとき: Story = {
  render: () => <BubbleHarness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('textbox', { name: '本文' });
    await expect(canvas.queryByRole('toolbar', { name: '書式メニュー' })).toBeNull();
  },
};

/** 選んだとき。吹き出しが浮かび、書式のボタンが出る。 */
export const 選んだとき: Story = {
  render: () => <BubbleHarness selectAll />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getByRole('toolbar', { name: '書式メニュー' })).toBeVisible();
      },
      { timeout: 5000 },
    );
  },
};
