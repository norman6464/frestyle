import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { getEditorCommands, type EditorCommand } from '../editorCommands';
import { availableSlashItems, buildSlashItems } from '../slashItems';

let editor: Editor | null = null;

const paragraph = (text: string, id?: string): JSONContent => ({
  type: 'paragraph',
  ...(id ? { attrs: { id } } : {}),
  content: [{ type: 'text', text }],
});

const ID_A = '11111111-1111-4111-8111-111111111111';
const ID_B = '22222222-2222-4222-8222-222222222222';
const ID_C = '33333333-3333-4333-8333-333333333333';

/** 3 つの段落（id 付き）。 */
const threeDoc: JSONContent = {
  type: 'doc',
  content: [paragraph('一', ID_A), paragraph('二', ID_B), paragraph('三', ID_C)],
};

function makeEditor(content: JSONContent = threeDoc): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  return editor;
}

/** text を含む段落の中へカーソルを置く。 */
function placeCursorIn(e: Editor, text: string) {
  let found = -1;
  e.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isText && node.text === text) found = pos;
  });
  if (found === -1) throw new Error(`「${text}」が見つからない`);
  e.commands.setTextSelection(found + 1);
}

const texts = (e: Editor) => (e.getJSON().content ?? []).map((node) => node.content?.[0]?.text ?? '');
const ids = (e: Editor) => (e.getJSON().content ?? []).map((node) => node.attrs?.id as string);
const command = (id: string): EditorCommand => {
  const found = getEditorCommands('block').find((c) => c.id === id);
  if (!found) throw new Error(`ブロックの命令 ${id} が無い`);
  return found;
};

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('ブロックの操作の命令（group: block）', () => {
  it('上へ移動・下へ移動・複製・削除の 4 つを持ち、読み上げ名は日本語', () => {
    expect(getEditorCommands('block').map((c) => c.label)).toEqual(['上へ移動', '下へ移動', '複製', 'ブロックを削除']);
  });

  it('上へ移動: カーソルのあるブロックが 1 つ上と入れ替わり、id とカーソルは付いていく', () => {
    const e = makeEditor();
    placeCursorIn(e, '二');
    command('moveBlockUp').run(e);
    expect(texts(e)).toEqual(['二', '一', '三']);
    // ブロックの id は中身に付いたまま動く（コメントの錨が外れない）。
    expect(ids(e)).toEqual([ID_B, ID_A, ID_C]);
    // カーソルは動かしたブロックの中にある。
    expect(e.state.doc.resolve(e.state.selection.from).parent.textContent).toBe('二');
  });

  it('下へ移動', () => {
    const e = makeEditor();
    placeCursorIn(e, '二');
    command('moveBlockDown').run(e);
    expect(texts(e)).toEqual(['一', '三', '二']);
    expect(ids(e)).toEqual([ID_A, ID_C, ID_B]);
  });

  it('いちばん上では上へ、いちばん下では下へ動かせない', () => {
    const e = makeEditor();
    placeCursorIn(e, '一');
    expect(command('moveBlockUp').isEnabled?.(e)).toBe(false);
    expect(command('moveBlockDown').isEnabled?.(e)).toBe(true);
    placeCursorIn(e, '三');
    expect(command('moveBlockDown').isEnabled?.(e)).toBe(false);
  });

  it('リストの中の段落にカーソルがあっても、動くのはいちばん外のブロック（リスト全体）', () => {
    // 文書の最後は段落にしておく（最後がリストだと、StarterKit の TrailingNode が空の段落を足す）。
    const e = makeEditor({
      type: 'doc',
      content: [
        paragraph('一', ID_A),
        {
          type: 'bulletList',
          attrs: { id: ID_B },
          content: [{ type: 'listItem', content: [paragraph('項目')] }],
        },
        paragraph('三', ID_C),
      ],
    });
    placeCursorIn(e, '項目');
    command('moveBlockUp').run(e);
    expect((e.getJSON().content ?? []).map((node) => node.type)).toEqual(['bulletList', 'paragraph', 'paragraph']);
    expect(texts(e).slice(1)).toEqual(['一', '三']);
  });

  it('複製: 同じ中身のブロックが直後に入り、id は新しく振られる', () => {
    const e = makeEditor();
    placeCursorIn(e, '二');
    command('duplicateBlock').run(e);
    expect(texts(e)).toEqual(['一', '二', '二', '三']);
    const all = ids(e);
    expect(new Set(all).size).toBe(4);
    expect(all[1]).toBe(ID_B);
    expect(all[2]).not.toBe(ID_B);
    expect(all[2]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('複製: 入れ子の中の id も新しく振られる（同じ id が 2 つにならない）', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          attrs: { id: ID_A },
          content: [{ type: 'listItem', attrs: { id: ID_B }, content: [paragraph('項目', ID_C)] }],
        },
      ],
    });
    placeCursorIn(e, '項目');
    command('duplicateBlock').run(e);
    const seen: string[] = [];
    e.state.doc.descendants((node) => {
      if (typeof node.attrs.id === 'string') seen.push(node.attrs.id);
    });
    expect(seen).toHaveLength(6);
    expect(new Set(seen).size).toBe(6);
  });

  it('削除: ブロックが消え、カーソルは次（無ければ前）のブロックへ', () => {
    const e = makeEditor();
    placeCursorIn(e, '二');
    command('deleteBlock').run(e);
    expect(texts(e)).toEqual(['一', '三']);
    expect(e.state.doc.resolve(e.state.selection.from).parent.textContent).toBe('三');
  });

  it('削除: 最後の 1 つを消すと空の段落が残る（本文が空にならない）', () => {
    const e = makeEditor({ type: 'doc', content: [paragraph('一', ID_A)] });
    placeCursorIn(e, '一');
    command('deleteBlock').run(e);
    expect(e.getJSON().content).toHaveLength(1);
    expect(e.getJSON().content?.[0]?.type).toBe('paragraph');
    expect(e.getText()).toBe('');
  });

  it('キーボード: Alt+↑ / Alt+↓ でブロックが動き、カーソルも付いていく', () => {
    const e = makeEditor();
    placeCursorIn(e, '二');
    // 本物のキー入力で確かめる。tiptap の keyboardShortcut 命令は、ショートカットが作った変更の
    // 手順だけを写してカーソルの移動を捨てるので、2 回目の操作が「いちばん下」扱いになり実態と違う。
    const press = (key: string) => e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, altKey: true, bubbles: true }));
    press('ArrowUp');
    expect(texts(e)).toEqual(['二', '一', '三']);
    expect(e.state.doc.resolve(e.state.selection.from).parent.textContent).toBe('二');
    press('ArrowDown');
    expect(texts(e)).toEqual(['一', '二', '三']);
    expect(e.state.doc.resolve(e.state.selection.from).parent.textContent).toBe('二');
  });

  it("'/' メニューにも載り、いちばん上では「上へ移動」が候補から外れる", () => {
    const e = makeEditor();
    placeCursorIn(e, '一');
    const at = availableSlashItems(e, buildSlashItems()).map((item) => item.id);
    expect(at).toContain('duplicateBlock');
    expect(at).toContain('moveBlockDown');
    expect(at).not.toContain('moveBlockUp');
  });
});
