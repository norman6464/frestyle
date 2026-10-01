import { describe, it, expect, afterEach } from 'vitest';
import { Editor } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';

/**
 * 文字色（textStyle）と蛍光ペン（highlight）は名前だけを持つ。生の色コードや CSS の値は、
 * 命令からも貼り付けからも入らないことを、入力・貼り付け・書き出しの 3 経路で確かめる。
 */
let editor: Editor | null = null;

function makeEditor(text = '色のついた文字'): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    // 空文字の text ノードは作れない（貼り付けの検査では空の段落から始める）。
    content: { type: 'doc', content: [{ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) }] },
  });
  editor.commands.selectAll();
  return editor;
}

const pasteEvent = () => new Event('paste') as ClipboardEvent;
const firstTextMarks = (e: Editor) => e.getJSON().content?.[0]?.content?.[0]?.marks ?? [];

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('文字色（textStyle）', () => {
  it('許した名前で掛かり、書き出す HTML は data-color だけで style を持たない', () => {
    const e = makeEditor();
    expect(e.commands.setTextColor('red')).toBe(true);
    expect(firstTextMarks(e)).toEqual([{ type: 'textStyle', attrs: { color: 'red' } }]);
    const html = e.getHTML();
    expect(html).toContain('data-color="red"');
    expect(html).not.toContain('style=');
  });

  it('許していない値（生の色コード）は掛からず false', () => {
    const e = makeEditor();
    expect(e.commands.setTextColor('#ff0000' as never)).toBe(false);
    expect(firstTextMarks(e)).toEqual([]);
  });

  it('外せる', () => {
    const e = makeEditor();
    e.commands.setTextColor('blue');
    expect(e.commands.unsetTextColor()).toBe(true);
    expect(firstTextMarks(e)).toEqual([]);
  });

  it('貼り付け: data-color の名前は取り込み、style の色は落とす', () => {
    const e = makeEditor('');
    e.view.pasteHTML('<p><span data-color="green">緑</span><span style="color: rgb(255, 0, 0)">赤</span></p>', pasteEvent());
    const inline = e.getJSON().content?.[0]?.content ?? [];
    expect(inline.find((n) => n.text === '緑')?.marks).toEqual([{ type: 'textStyle', attrs: { color: 'green' } }]);
    expect(inline.find((n) => n.text === '赤')?.marks ?? []).toEqual([]);
  });

  it('貼り付け: 知らない名前の data-color は落とす', () => {
    const e = makeEditor('');
    e.view.pasteHTML('<p><span data-color="#00ff00">x</span></p>', pasteEvent());
    expect(firstTextMarks(e)).toEqual([]);
  });
});

describe('蛍光ペン（highlight）', () => {
  it('許した名前で掛かり、書き出す HTML は <mark data-color>', () => {
    const e = makeEditor();
    expect(e.commands.setHighlight('yellow')).toBe(true);
    expect(firstTextMarks(e)).toEqual([{ type: 'highlight', attrs: { color: 'yellow' } }]);
    expect(e.getHTML()).toContain('<mark data-color="yellow"');
    expect(e.getHTML()).not.toContain('style=');
  });

  it('許していない値は掛からず false', () => {
    const e = makeEditor();
    expect(e.commands.setHighlight('rgb(0,0,0)' as never)).toBe(false);
    expect(firstTextMarks(e)).toEqual([]);
  });

  it('外せる', () => {
    const e = makeEditor();
    e.commands.setHighlight('pink');
    expect(e.commands.unsetHighlight()).toBe(true);
    expect(firstTextMarks(e)).toEqual([]);
  });

  it('貼り付け: 名前の無い <mark>（ほかのサイトから）は黄にし、知らない名前も黄にする', () => {
    const e = makeEditor('');
    // 同じ色が隣り合うと 1 つの text ノードにまとまるので、間に素の文字を挟む。
    e.view.pasteHTML('<p><mark>a</mark>-<mark data-color="zzz">b</mark>-<mark data-color="blue">c</mark></p>', pasteEvent());
    const inline = e.getJSON().content?.[0]?.content ?? [];
    expect(inline.find((n) => n.text === 'a')?.marks).toEqual([{ type: 'highlight', attrs: { color: 'yellow' } }]);
    expect(inline.find((n) => n.text === 'b')?.marks).toEqual([{ type: 'highlight', attrs: { color: 'yellow' } }]);
    expect(inline.find((n) => n.text === 'c')?.marks).toEqual([{ type: 'highlight', attrs: { color: 'blue' } }]);
  });

  it('文字色と蛍光ペンは同時に掛けられる（太字などとも共存する）', () => {
    const e = makeEditor();
    e.commands.setTextColor('purple');
    e.commands.setHighlight('gray');
    e.commands.toggleBold();
    expect(firstTextMarks(e).map((m) => m.type).sort()).toEqual(['bold', 'highlight', 'textStyle']);
  });
});
