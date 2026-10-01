import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { EDITOR_COMMANDS, getEditorCommands, type EditorCommand } from '../editorCommands';

let editor: Editor | null = null;

function makeEditor(): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content: emptyRichDoc(),
  });
  return editor;
}

function byId(id: string): EditorCommand {
  const command = EDITOR_COMMANDS.find((c) => c.id === id);
  if (!command) throw new Error(`command not found: ${id}`);
  return command;
}

function findNode(node: JSONContent, type: string): JSONContent | undefined {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('EDITOR_COMMANDS レジストリ', () => {
  it('id が一意で、必須フィールドを備える', () => {
    const ids = EDITOR_COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of EDITOR_COMMANDS) {
      expect(command.label).toBeTruthy();
      expect(command.glyph).toBeTruthy();
      expect(typeof command.run).toBe('function');
    }
  });

  it('getEditorCommands はグループで絞り込む（引数なしは全件）', () => {
    expect(getEditorCommands()).toHaveLength(EDITOR_COMMANDS.length);
    expect(getEditorCommands('mark').every((c) => c.group === 'mark')).toBe(true);
    const bubble = getEditorCommands('mark', 'turn');
    expect(bubble.some((c) => c.id === 'bold')).toBe(true);
    expect(bubble.some((c) => c.id === 'heading1')).toBe(true);
    expect(bubble.some((c) => c.id === 'undo')).toBe(false);
  });
});

describe('マーク系コマンド', () => {
  it.each(['bold', 'italic', 'underline', 'strike', 'code'])(
    '%s は run でトグルし isActive に反映される',
    (id) => {
      const e = makeEditor();
      const command = byId(id);
      expect(command.isActive?.(e)).toBe(false);
      command.run(e);
      expect(command.isActive?.(e)).toBe(true);
      command.run(e);
      expect(command.isActive?.(e)).toBe(false);
    },
  );
});

describe('ブロック変換コマンド', () => {
  it('見出し1〜3 は対応する level の heading になる', () => {
    for (const [id, level] of [
      ['heading1', 1],
      ['heading2', 2],
      ['heading3', 3],
    ] as const) {
      const e = makeEditor();
      byId(id).run(e);
      expect(byId(id).isActive?.(e)).toBe(true);
      expect(findNode(e.getJSON(), 'heading')?.attrs?.level).toBe(level);
      e.destroy();
    }
    editor = null;
  });

  it.each([
    ['bulletList', 'bulletList'],
    ['orderedList', 'orderedList'],
    ['blockquote', 'blockquote'],
    ['codeBlock', 'codeBlock'],
  ])('%s は run で doc に %s ノードが現れる', (id, nodeType) => {
    const e = makeEditor();
    byId(id).run(e);
    expect(findNode(e.getJSON(), nodeType)).toBeDefined();
    expect(byId(id).isActive?.(e)).toBe(true);
  });
});

describe('マークの混在', () => {
  // 複数の装飾を重ねたときに後勝ちで消えたりせず、同じテキストへ併存することを保証する。
  it('太字・斜体・下線・打ち消し・インラインコードを重ねがけできる', () => {
    const e = makeEditor();
    e.commands.insertContent('装飾テスト');
    e.commands.selectAll();
    for (const id of ['bold', 'italic', 'underline', 'strike', 'code']) {
      byId(id).run(e);
    }
    const text = findNode(e.getJSON(), 'text');
    const marks = (text?.marks ?? []).map((mark) => mark.type).sort();
    expect(marks).toEqual(['bold', 'code', 'italic', 'strike', 'underline']);
    // レジストリの isActive も全て true を返す（UI 表示と doc の状態が一致する）。
    for (const id of ['bold', 'italic', 'underline', 'strike', 'code']) {
      expect(byId(id).isActive?.(e)).toBe(true);
    }
  });

  it('見出しの中でもマークを重ねられる（ブロック変換とマークが両立する）', () => {
    const e = makeEditor();
    e.commands.insertContent('見出しに装飾');
    e.commands.selectAll();
    byId('heading2').run(e);
    byId('bold').run(e);
    byId('code').run(e);
    const heading = findNode(e.getJSON(), 'heading');
    expect(heading?.attrs?.level).toBe(2);
    const marks = (findNode(e.getJSON(), 'text')?.marks ?? []).map((mark) => mark.type).sort();
    expect(marks).toEqual(['bold', 'code']);
  });
});

describe('挿入・履歴コマンド', () => {
  it('水平線は run で horizontalRule を挿入する（非トグル: isActive なし）', () => {
    const e = makeEditor();
    const command = byId('horizontalRule');
    expect(command.isActive).toBeUndefined();
    command.run(e);
    expect(findNode(e.getJSON(), 'horizontalRule')).toBeDefined();
  });

  it('undo は初期は不可、編集後に可能になる。redo は初期不可', () => {
    const e = makeEditor();
    expect(byId('undo').isEnabled?.(e)).toBe(false);
    expect(byId('redo').isEnabled?.(e)).toBe(false);
    e.commands.insertContent('あ');
    expect(byId('undo').isEnabled?.(e)).toBe(true);
  });
});
