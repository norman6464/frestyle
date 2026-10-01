import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { findAdjacentListBoundaries } from '../listNormalization';

let editor: Editor | null = null;

function makeEditor(content: JSONContent = emptyRichDoc()): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  return editor;
}

/**
 * typeText は input rule を発火させるため、ユーザーのキー入力と同じ経路
 * （view の handleTextInput）で 1 文字ずつ入力する（insertContent では発火しない）。
 */
function typeText(e: Editor, text: string) {
  for (const ch of text) {
    const { from, to } = e.state.selection;
    const handled = e.view.someProp('handleTextInput', (f) => f(e.view, from, to, ch));
    if (!handled) {
      e.view.dispatch(e.state.tr.insertText(ch, from, to));
    }
  }
}

const listItem = (text: string): JSONContent => ({
  type: 'listItem',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('見出しの入力ルール（# / ＃）', () => {
  it.each([
    ['# ', 1],
    ['## ', 2],
    ['### ', 3],
  ])('半角 %s で見出し%i になる（既定ルールの維持）', (input, level) => {
    const e = makeEditor();
    typeText(e, input);
    const first = e.getJSON().content?.[0];
    expect(first?.type).toBe('heading');
    expect(first?.attrs?.level).toBe(level);
  });

  it.each([
    ['＃ ', 1],
    ['＃＃ ', 2],
    ['＃＃＃ ', 3],
  ])('全角 %s（半角スペース確定）で見出し%i になる', (input, level) => {
    const e = makeEditor();
    typeText(e, input);
    const first = e.getJSON().content?.[0];
    expect(first?.type).toBe('heading');
    expect(first?.attrs?.level).toBe(level);
  });

  it('全角スペースでの確定（＃＃　）でも見出し2になる', () => {
    const e = makeEditor();
    typeText(e, '＃＃　');
    const first = e.getJSON().content?.[0];
    expect(first?.type).toBe('heading');
    expect(first?.attrs?.level).toBe(2);
  });

  it('全角と半角の混在（＃# ）でも見出し2になる', () => {
    const e = makeEditor();
    typeText(e, '＃# ');
    const first = e.getJSON().content?.[0];
    expect(first?.type).toBe('heading');
    expect(first?.attrs?.level).toBe(2);
  });

  it('スペースを打たなければ変換しない（＃ のまま本文）', () => {
    const e = makeEditor();
    typeText(e, '＃見出しにしない');
    expect(e.getJSON().content?.[0]?.type).toBe('paragraph');
  });
});

describe('隣接リストの自動結合（番号リセットの修正）', () => {
  it('隣接する 2 つの orderedList は編集をきっかけに 1 つへ結合され、項目順は保たれる', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        { type: 'orderedList', content: [listItem('一'), listItem('二')] },
        { type: 'orderedList', content: [listItem('三'), listItem('四'), listItem('五')] },
      ],
    });
    // appendTransaction は docChanged をきっかけに走るので、末尾に 1 文字入力して発火させる。
    e.commands.focus('end');
    typeText(e, '。');
    const lists = (e.getJSON().content ?? []).filter((node) => node.type === 'orderedList');
    expect(lists).toHaveLength(1);
    const texts = lists[0].content?.map((item) => item.content?.[0]?.content?.[0]?.text);
    expect(texts).toEqual(['一', '二', '三', '四', '五。']);
  });

  it('bulletList も同様に結合される', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        { type: 'bulletList', content: [listItem('A')] },
        { type: 'bulletList', content: [listItem('B')] },
      ],
    });
    e.commands.focus('end');
    typeText(e, '!');
    const lists = (e.getJSON().content ?? []).filter((node) => node.type === 'bulletList');
    expect(lists).toHaveLength(1);
    expect(lists[0].content).toHaveLength(2);
  });

  it('段落を挟んだ独立リストは結合しない', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        { type: 'orderedList', content: [listItem('一')] },
        { type: 'paragraph', content: [{ type: 'text', text: '間の文章' }] },
        { type: 'orderedList', content: [listItem('また一から')] },
      ],
    });
    e.commands.focus('end');
    typeText(e, '。');
    const lists = (e.getJSON().content ?? []).filter((node) => node.type === 'orderedList');
    expect(lists).toHaveLength(2);
  });

  it('種類の違うリスト（ordered と bullet）は結合しない', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        { type: 'orderedList', content: [listItem('番号')] },
        { type: 'bulletList', content: [listItem('黒丸')] },
      ],
    });
    e.commands.focus('end');
    typeText(e, '。');
    // 末尾入力の位置によって段落が増えることはあるが、リスト同士は結合されない。
    const types = (e.getJSON().content ?? []).map((node) => node.type);
    expect(types.slice(0, 2)).toEqual(['orderedList', 'bulletList']);
    expect(types.filter((t) => t === 'orderedList')).toHaveLength(1);
    expect(types.filter((t) => t === 'bulletList')).toHaveLength(1);
  });

  it('findAdjacentListBoundaries は隣接境界だけを検出する', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        { type: 'orderedList', content: [listItem('一')] },
        { type: 'orderedList', content: [listItem('二')] },
        { type: 'paragraph' },
        { type: 'bulletList', content: [listItem('A')] },
      ],
    });
    expect(findAdjacentListBoundaries(e.state.doc)).toHaveLength(1);
  });
});
