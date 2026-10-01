import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor } from '@tiptap/react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import FormatMenuBar from './FormatMenuBar';
import { createEditorExtensions } from './editorExtensions';
import type { CommentAnchor } from './commentAnchor';
import './richTextEditor.css';

/**
 * 太字・斜体・見出し・リストなどを並べたボタンの列。
 *
 * ふだんは画面上部に固定せず、**文字を選んだときだけ浮かぶ吹き出し**（BubbleFormatMenu）の
 * 中身として出る。ここでは中身だけを取り出して見ている。
 *
 * ボタンを押しても本文の選択が外れないようにしてある。外れると「どこに書式を掛けるのか」が
 * 分からなくなるため。
 *
 * この部品はエディタ本体（tiptap）が無いと動かないので、見本では小さなエディタを一緒に作っている。
 */
/*
 * この部品は単体では立てられない（エディタ本体が要る）。args ではなく render の中で
 * 作るので、meta も satisfies ではなく注釈で受けて args を任意にする。
 */
const meta: Meta<typeof FormatMenuBar> = {
  title: 'pages/kb/editor/FormatMenuBar',
  component: FormatMenuBar,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof FormatMenuBar>;

// id は「コメント」ボタンの見本（下の 選択してコメントを付ける）が resolveCommentAnchor で
// 錨を計算できるように付けてある（本物の画面では StableBlockId が保存のたびに補う）。
const SAMPLE_BLOCK_ID = 'sample-block-1';
const SAMPLE = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: SAMPLE_BLOCK_ID },
      content: [{ type: 'text', text: 'ここの文字を選んで書式を変えます。' }],
    },
  ],
};

/** 見本用の小さなエディタ。書式の効き目を目で確かめられるよう、本文も一緒に出す。 */
function MenuBarHarness({
  selectAll = false,
  selectBlockText = false,
  editable = true,
  onRequestComment,
}: {
  selectAll?: boolean;
  /**
   * selectAll と違い、ProseMirror の AllSelection ではなく段落の中の TextSelection にする。
   * AllSelection は $from/$to が doc 直下（depth 0）に解決され、ブロックの中を指さない
   * ため、resolveCommentAnchor（commentAnchor.ts）が「ブロックの外」と判定して常に null に
   * なる — 「コメント」ボタンの見本ではブロック内の選択が要る。
   */
  selectBlockText?: boolean;
  editable?: boolean;
  onRequestComment?: (anchor: CommentAnchor) => void;
}) {
  const editor = useEditor({
    extensions: createEditorExtensions({}),
    content: SAMPLE,
    editorProps: {
      attributes: { role: 'textbox', 'aria-multiline': 'true', 'aria-label': '本文' },
    },
    onCreate: ({ editor: created }) => {
      if (selectAll) created.commands.selectAll();
      if (selectBlockText) {
        created.commands.setTextSelection({ from: 1, to: created.state.doc.content.size - 1 });
      }
    },
  });

  if (!editor) return null;

  return (
    <div className="max-w-2xl space-y-3">
      <div className="rte-bubble inline-flex">
        <FormatMenuBar editor={editor as Editor} editable={editable} onRequestComment={onRequestComment} />
      </div>
      <div className="rounded border border-surface-3 p-3">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}

/** 何も選んでいないとき。 */
export const 既定: Story = {
  render: () => <MenuBarHarness />,
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('toolbar', { name: '書式メニュー' }),
    ).toBeVisible();
  },
};

/** 文字を選んだ状態。ここから太字などを掛けられる。 */
export const 選んだ状態: Story = {
  render: () => <MenuBarHarness selectAll />,
};

/** 太字を押すと、選んだところが太くなる。 */
export const 太字にする: Story = {
  render: () => <MenuBarHarness selectAll />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const bold = await canvas.findByRole('button', { name: '太字' });
    await userEvent.click(bold);
    await waitFor(async () => {
      // 押されている状態が、色だけでなく属性でも伝わる。
      await expect(bold).toHaveAttribute('aria-pressed', 'true');
    });
    await expect(canvasElement.querySelector('strong')).not.toBeNull();
  },
};

// render と play が同じインスタンスを参照できるよう、コールバックの結果をここへ書く
// （このコンポーネントは args ではなく render の中で組み立てる作りのため、
// fn() を args 経由で受け渡す通常のやり方が使えない）。
let requestedAnchor: CommentAnchor | null = null;

/**
 * 文字を選んでから「コメント」を押すと、その選択範囲から計算した錨
 * （ブロックID・ブロック内オフセット・引用文）が onRequestComment に渡る。
 */
export const 選択してコメントを付ける: Story = {
  render: () => (
    <MenuBarHarness
      selectBlockText
      onRequestComment={(anchor) => {
        requestedAnchor = anchor;
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    requestedAnchor = null;
    const canvas = within(canvasElement);
    const commentButton = await canvas.findByRole('button', { name: 'コメント' });
    await waitFor(() => expect(commentButton).toBeEnabled());

    await userEvent.click(commentButton);

    await waitFor(() => expect(requestedAnchor).not.toBeNull());
    await expect(requestedAnchor).toEqual({
      blockId: 'sample-block-1',
      anchorFrom: 0,
      anchorTo: 17,
      quote: 'ここの文字を選んで書式を変えます。',
    });
  },
};

/**
 * 編集権限は無いがコメントだけできる立場（domain.GrantRoleCommenter）。
 * 太字等の書式ボタン・リンクは出さないが、「コメント」ボタンだけは出て使える
 * （editable と canComment は別軸 — CodeRabbit 指摘の回帰確認）。
 */
export const 編集権限が無くてもコメントだけはできる: Story = {
  render: () => (
    <MenuBarHarness
      selectBlockText
      editable={false}
      onRequestComment={(anchor) => {
        requestedAnchor = anchor;
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    requestedAnchor = null;
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '太字' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'リンク' })).not.toBeInTheDocument();

    const commentButton = await canvas.findByRole('button', { name: 'コメント' });
    await waitFor(() => expect(commentButton).toBeEnabled());
    await userEvent.click(commentButton);

    await waitFor(() => expect(requestedAnchor).not.toBeNull());
  },
};
