import { describe, it, expect, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Editor, type JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { EDITOR_COMMANDS } from '../editorCommands';
import { buildSlashItems } from '../slashItems';

let editor: Editor | null = null;

function makeEditor(content: JSONContent = emptyRichDoc()): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  return editor;
}

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
  ],
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('表（TableKit）', () => {
  it('表を含む doc がスキーマに受理され、そのまま往復する', () => {
    const e = makeEditor(tableDoc);
    const table = e.getJSON().content?.[0];
    expect(table?.type).toBe('table');
    expect(table?.content).toHaveLength(2);
  });

  it('表コマンド（レジストリ）で 3x3 のヘッダー行つき表が挿入される', () => {
    const e = makeEditor();
    const command = EDITOR_COMMANDS.find((c) => c.id === 'table');
    expect(command).toBeDefined();
    command!.run(e);
    const table = e.getJSON().content?.find((node) => node.type === 'table');
    expect(table).toBeDefined();
    expect(table?.content).toHaveLength(3); // 3 行
    expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableHeader');
  });

  it("'/' メニューの候補に表（/table）が含まれる", () => {
    const ids = buildSlashItems().map((item) => item.id);
    expect(ids).toContain('table');
  });

  it('読み取り専用（editable=false）でも表が描画される', () => {
    const { container } = render(<RichTextEditor value={tableDoc as never} editable={false} />);
    expect(screen.getByText('列A')).toBeInTheDocument();
    expect(screen.getByText('あ')).toBeInTheDocument();
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect(container.querySelectorAll('th')).toHaveLength(2);
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });
});
