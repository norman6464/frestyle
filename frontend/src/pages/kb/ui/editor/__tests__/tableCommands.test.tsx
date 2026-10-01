import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { CellSelection } from '@tiptap/pm/tables';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { getEditorCommands, type EditorCommand } from '../editorCommands';
import { availableSlashItems, buildSlashItems } from '../slashItems';

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

/** 見出し行 1 行＋本文 2 行、2 列の表。 */
const tableDoc: JSONContent = {
  type: 'doc',
  content: [
    {
      type: 'table',
      content: [
        { type: 'tableRow', content: [cell('tableHeader', '列A'), cell('tableHeader', '列B')] },
        { type: 'tableRow', content: [cell('tableCell', 'あ'), cell('tableCell', 'い')] },
        { type: 'tableRow', content: [cell('tableCell', 'う'), cell('tableCell', 'え')] },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: '表の外の段落' }] },
  ],
};

/** 表の中の、文字 text を含むセルへカーソルを置く。 */
function placeCursorIn(e: Editor, text: string) {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos;
  });
  if (found === -1) throw new Error(`セル「${text}」が見つからない`);
  e.commands.setTextSelection(found + 1);
}

const tableOf = (e: Editor) => e.getJSON().content?.find((node) => node.type === 'table');
const rowsOf = (e: Editor) => tableOf(e)?.content ?? [];
const command = (id: string): EditorCommand => {
  const found = getEditorCommands('table').find((c) => c.id === id);
  if (!found) throw new Error(`表の命令 ${id} が無い`);
  return found;
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('表の操作の命令（group: table）', () => {
  it('行・列の追加と削除、見出し行、結合と分割、表の削除の 9 つを持ち、読み上げ名は日本語', () => {
    const labels = getEditorCommands('table').map((c) => c.label);
    expect(labels).toEqual([
      '上に行を足す',
      '下に行を足す',
      '左に列を足す',
      '右に列を足す',
      '行を消す',
      '列を消す',
      '見出し行の切り替え',
      'セルを結合／分割',
      '表を消す',
    ]);
  });

  it('表の外ではどの命令も実行できない（isEnabled が false）', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, '表の外の段落');
    for (const c of getEditorCommands('table')) {
      expect(c.isEnabled?.(e), c.id).toBe(false);
    }
  });

  it('下に行を足す／上に行を足す: カーソルのある行の下・上に本文の行が増える', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, 'あ');
    expect(command('addRowAfter').isEnabled?.(e)).toBe(true);
    command('addRowAfter').run(e);
    expect(rowsOf(e)).toHaveLength(4);
    // 2 行目（あ・い）の下に空の行が入る。
    expect(rowsOf(e)[2].content?.map((c) => c.type)).toEqual(['tableCell', 'tableCell']);

    placeCursorIn(e, 'あ');
    command('addRowBefore').run(e);
    expect(rowsOf(e)).toHaveLength(5);
  });

  it('右に列を足す／左に列を足す: すべての行のセルが 1 つ増える', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, 'い');
    command('addColumnAfter').run(e);
    for (const row of rowsOf(e)) expect(row.content).toHaveLength(3);
    placeCursorIn(e, 'い');
    command('addColumnBefore').run(e);
    for (const row of rowsOf(e)) expect(row.content).toHaveLength(4);
  });

  it('行を消す／列を消す', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, 'う');
    command('deleteRow').run(e);
    expect(rowsOf(e)).toHaveLength(2);
    placeCursorIn(e, 'い');
    command('deleteColumn').run(e);
    for (const row of rowsOf(e)) expect(row.content).toHaveLength(1);
  });

  it('見出し行の切り替え: 1 行目が見出し ⇄ 本文になる', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, 'あ');
    command('toggleHeaderRow').run(e);
    expect(rowsOf(e)[0].content?.map((c) => c.type)).toEqual(['tableCell', 'tableCell']);
    command('toggleHeaderRow').run(e);
    expect(rowsOf(e)[0].content?.map((c) => c.type)).toEqual(['tableHeader', 'tableHeader']);
  });

  it('セルを結合／分割: 2 つのセルを選ぶと 1 つにまとまり、もう一度押すと元に戻る', () => {
    const e = makeEditor(tableDoc);
    // 「あ」と「い」のセルを選ぶ（CellSelection）。
    let from = -1;
    let to = -1;
    e.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tableCell') {
        if (node.textContent === 'あ') from = pos;
        if (node.textContent === 'い') to = pos;
      }
    });
    const selection = CellSelection.create(e.state.doc, from, to);
    e.view.dispatch(e.state.tr.setSelection(selection));
    // 1 つのセルだけのときは何もできない（結合する相手も、分かれるものも無い）。
    expect(command('mergeOrSplit').isEnabled?.(e)).toBe(true);
    command('mergeOrSplit').run(e);
    expect(rowsOf(e)[1].content).toHaveLength(1);
    expect(rowsOf(e)[1].content?.[0]?.attrs?.colspan).toBe(2);

    command('mergeOrSplit').run(e);
    expect(rowsOf(e)[1].content).toHaveLength(2);
  });

  it('何も結合していない 1 つのセルでは、結合／分割は押せない', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, 'あ');
    expect(command('mergeOrSplit').isEnabled?.(e)).toBe(false);
  });

  it('表を消す: 表が無くなり、外の段落は残る', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, 'あ');
    command('deleteTable').run(e);
    expect(tableOf(e)).toBeUndefined();
    expect(e.getText()).toContain('表の外の段落');
  });
});

describe("'/' メニューと表の操作", () => {
  it('表の操作は候補の元の一覧に含まれる（キーボードだけでも届くように）', () => {
    const ids = buildSlashItems().map((item) => item.id);
    expect(ids).toContain('addRowAfter');
    expect(ids).toContain('deleteTable');
  });

  it('表の外では、その場で実行できない命令（表の操作）を候補から外す', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, '表の外の段落');
    const ids = availableSlashItems(e, buildSlashItems()).map((item) => item.id);
    expect(ids).not.toContain('addRowAfter');
    expect(ids).toContain('table');
    expect(ids).toContain('heading1');
  });

  it('表の中では、表の操作が候補に出る', () => {
    const e = makeEditor(tableDoc);
    placeCursorIn(e, 'あ');
    const ids = availableSlashItems(e, buildSlashItems()).map((item) => item.id);
    expect(ids).toContain('addRowAfter');
    expect(ids).toContain('deleteTable');
  });
});
