import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { useEditor, type Editor } from '@tiptap/react';
import ColorFormatControl from '../ColorFormatControl';
import { createEditorExtensions } from '../editorExtensions';

function Harness({ onEditor }: { onEditor?: (editor: Editor) => void }) {
  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '色の文字' }] }] },
  });
  useEffect(() => {
    if (!editor) return;
    editor.commands.selectAll();
    onEditor?.(editor);
  }, [editor, onEditor]);
  if (!editor) return null;
  return <ColorFormatControl editor={editor} />;
}

const firstTextMarks = (e: Editor) => e.getJSON().content?.[0]?.content?.[0]?.marks ?? [];

describe('ColorFormatControl', () => {
  it('「色」を押すと、文字色と蛍光ペンの 8 色＋なしが開く', async () => {
    render(<Harness />);
    expect(screen.queryByRole('group', { name: '文字色' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '色' }));
    const text = await screen.findByRole('group', { name: '文字色' });
    const highlight = screen.getByRole('group', { name: '蛍光ペン' });
    for (const g of [text, highlight]) {
      for (const name of ['赤', '橙', '黄', '緑', '青', '紫', '桃', '灰', 'なし']) {
        expect(within(g).getByRole('button', { name })).toBeInTheDocument();
      }
    }
  });

  it('文字色の「赤」を押すと選択範囲に掛かり、押下状態になる。「なし」で外れる', async () => {
    let editor: Editor | null = null;
    render(<Harness onEditor={(e) => (editor = e)} />);
    fireEvent.click(screen.getByRole('button', { name: '色' }));
    const text = await screen.findByRole('group', { name: '文字色' });
    fireEvent.click(within(text).getByRole('button', { name: '赤' }));
    await waitFor(() => expect(firstTextMarks(editor!)).toEqual([{ type: 'textStyle', attrs: { color: 'red' } }]));
    await waitFor(() => expect(within(text).getByRole('button', { name: '赤' })).toHaveAttribute('aria-pressed', 'true'));
    expect(within(text).getByRole('button', { name: '青' })).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(within(text).getByRole('button', { name: 'なし' }));
    await waitFor(() => expect(firstTextMarks(editor!)).toEqual([]));
  });

  it('蛍光ペンの「黄」を押すと掛かる', async () => {
    let editor: Editor | null = null;
    render(<Harness onEditor={(e) => (editor = e)} />);
    fireEvent.click(screen.getByRole('button', { name: '色' }));
    const highlight = await screen.findByRole('group', { name: '蛍光ペン' });
    fireEvent.click(within(highlight).getByRole('button', { name: '黄' }));
    await waitFor(() => expect(firstTextMarks(editor!)).toEqual([{ type: 'highlight', attrs: { color: 'yellow' } }]));
  });

  it('Escape で閉じる', async () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '色' }));
    const text = await screen.findByRole('group', { name: '文字色' });
    fireEvent.keyDown(text, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('group', { name: '文字色' })).toBeNull());
  });
});
