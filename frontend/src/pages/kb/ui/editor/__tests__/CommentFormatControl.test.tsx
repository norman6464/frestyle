import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEditor, type Editor, type JSONContent } from '@tiptap/react';
import CommentFormatControl from '../CommentFormatControl';
import { createEditorExtensions } from '../editorExtensions';
import type { CommentAnchor } from '../commentAnchor';

const docWithBlockId: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      attrs: { id: 'block-1' },
      content: [{ type: 'text', text: 'Hello world' }],
    },
  ],
};

let editor: Editor | null = null;

/** Harness は実 editor を用意し、CommentFormatControl だけを描画する薄い入れ物。 */
function Harness({ onRequestComment }: { onRequestComment?: (anchor: CommentAnchor) => void }) {
  const created = useEditor({
    extensions: createEditorExtensions(),
    content: docWithBlockId,
    onCreate: ({ editor: instance }) => {
      editor = instance;
    },
  });
  if (!created) return null;
  return <CommentFormatControl editor={created} onRequestComment={onRequestComment} />;
}

beforeEach(() => {
  editor = null;
});

const commentButton = () => screen.getByRole('button', { name: 'コメント' });

describe('CommentFormatControl', () => {
  it('onRequestComment が渡されていなければ何も描画しない', async () => {
    const { container } = render(<Harness />);
    await waitFor(() => expect(editor).not.toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it('選択が空（カーソルのみ）なら disabled', async () => {
    render(<Harness onRequestComment={vi.fn()} />);
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => {
      editor!.commands.setTextSelection({ from: 3, to: 3 });
    });

    expect(commentButton()).toBeDisabled();
  });

  it('文字を選ぶと有効になり、押すと onRequestComment が正しい anchor で呼ばれる', async () => {
    const onRequestComment = vi.fn();
    render(<Harness onRequestComment={onRequestComment} />);
    await waitFor(() => expect(editor).not.toBeNull());
    // doc: 0=paragraph開始 / 1=本文開始。'world' は pos 7〜12。
    act(() => {
      editor!.commands.setTextSelection({ from: 7, to: 12 });
    });

    await waitFor(() => expect(commentButton()).not.toBeDisabled());
    fireEvent.click(commentButton());

    expect(onRequestComment).toHaveBeenCalledWith({
      blockId: 'block-1',
      anchorFrom: 6,
      anchorTo: 11,
      quote: 'world',
    });
  });

  it('onMouseDown で preventDefault し、選択を外さない', async () => {
    render(<Harness onRequestComment={vi.fn()} />);
    await waitFor(() => expect(editor).not.toBeNull());
    act(() => {
      editor!.commands.setTextSelection({ from: 7, to: 12 });
    });

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    const prevented = !fireEvent(commentButton(), event);
    expect(prevented).toBe(true);
  });
});
