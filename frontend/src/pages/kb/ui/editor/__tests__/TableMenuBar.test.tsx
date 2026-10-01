import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useEditor, type Editor, type JSONContent } from '@tiptap/react';
import TableMenuBar from '../TableMenuBar';
import { createEditorExtensions } from '../editorExtensions';

const cell = (type: 'tableHeader' | 'tableCell', text: string): JSONContent => ({
  type,
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

const tableDoc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', '列A'), cell('tableHeader', '列B')] },
        { type: 'tableRow', content: [cell('tableCell', 'あ'), cell('tableCell', 'い')] },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: '表の外' }] },
  ],
};

/**
 * カーソルを text のセル（または段落）へ置いた状態で TableMenuBar を出す薄いハーネス。
 * カーソルはエディタができたあとの効果で置く（作成時の onCreate だと、置いた選択が
 * 初期化の途中で上書きされて効かないことがある）。
 */
function Harness({ cursorAt, onEditor }: { cursorAt: string; onEditor?: (editor: Editor) => void }) {
  const editor = useEditor({
    extensions: createEditorExtensions(),
    content: tableDoc,
  });
  useEffect(() => {
    if (!editor) return;
    let found = -1;
    editor.state.doc.descendants((node, pos) => {
      if (found === -1 && node.isText && node.text === cursorAt) found = pos;
    });
    editor.commands.setTextSelection(found + 1);
    onEditor?.(editor);
  }, [editor, cursorAt, onEditor]);
  if (!editor) return null;
  return <TableMenuBar editor={editor} />;
}

describe('TableMenuBar', () => {
  it('表の操作のボタン列を出す（読み上げ名は日本語）', async () => {
    render(<Harness cursorAt="あ" />);
    expect(screen.getByRole('toolbar', { name: '表の操作' })).toBeInTheDocument();
    for (const name of ['上に行を足す', '下に行を足す', '左に列を足す', '右に列を足す', '行を消す', '列を消す', '見出し行の切り替え', '表を消す']) {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeEnabled());
    }
    // 1 つのセルだけでは結合する相手も分かれるものも無いので押せない。
    await waitFor(() => expect(screen.getByRole('button', { name: 'セルを結合／分割' })).toBeDisabled());
  });

  it('「下に行を足す」を押すと行が増える', async () => {
    let editor: Editor | null = null;
    render(<Harness cursorAt="あ" onEditor={(created) => (editor = created)} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '下に行を足す' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: '下に行を足す' }));
    await waitFor(() => {
      const table = editor?.getJSON().content?.find((node) => node.type === 'table');
      expect(table?.content).toHaveLength(3);
    });
  });

  it('表の外ではすべて押せない', async () => {
    render(<Harness cursorAt="表の外" />);
    for (const name of ['上に行を足す', '表を消す', 'セルを結合／分割']) {
      await waitFor(() => expect(screen.getByRole('button', { name })).toBeDisabled());
    }
  });
});
