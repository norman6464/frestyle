import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';

/*
 * 名指し（mention）は「表示名が人に追従するインラインの 1 要素」。表示名の正本はサーバーが
 * 読み出し時に解決するので、ここで確かめるのは描画の契約: 解決された名指しは「@名前」の札、
 * 写しが無い名指しは「@ユーザー」とだけ出す（押せる先は無い）。userId が整数の字面でない
 * ものは名指しとして取り込まない（atom として往復する）。
 */

let editor: Editor | null = null;

function makeEditor(content: JSONContent): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

const pasteEvent = () => new Event('paste') as ClipboardEvent;

function docWithMention(attrs: Record<string, unknown>): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'mention', attrs }] }],
  };
}

describe('名指し（mention）', () => {
  it('解決された名指しは「@名前」の札になり、userId を属性に持つ', () => {
    const e = makeEditor(docWithMention({ userId: '42', name: '田中' }));

    const html = e.getHTML();
    expect(html).toContain('data-mention');
    expect(html).toContain('data-user-id="42"');
    expect(html).toContain('@田中');
    expect(html).not.toContain('<a');
    expect(e.getText()).toContain('@田中');
  });

  it('写しが無い名指し（版のプレビュー・提案の表示・退会した人）は「@ユーザー」とだけ出す', () => {
    const e = makeEditor(docWithMention({ userId: '42', name: null }));
    const html = e.getHTML();
    expect(html).toContain('@ユーザー');
    expect(html).toContain('is-unresolved');
    expect(e.getText()).toContain('@ユーザー');
  });

  it('描画した HTML を貼り直しても名指しのまま戻る（コピー＆ペーストで劣化しない）', () => {
    const source = makeEditor(docWithMention({ userId: '42', name: '田中' }));
    const html = source.getHTML();
    source.destroy();

    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
    e.view.pasteHTML(html, pasteEvent());

    const node = findNode(e.getJSON(), 'mention');
    expect(node?.attrs).toEqual({ userId: '42', name: '田中' });
  });

  it('整数の字面でない userId を持つ HTML は名指しとして取り込まない', () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
    e.view.pasteHTML('<span data-mention="true" data-user-id="abc" data-name="偽物">@偽物</span>', pasteEvent());
    expect(findNode(e.getJSON(), 'mention')).toBeUndefined();
    expect(e.getText()).toContain('@偽物');
  });

  it('doc JSON として往復する（保存 → 再読込で名指しが消えない）', () => {
    const e = makeEditor(docWithMention({ userId: '42', name: '田中' }));
    expect(findNode(e.getJSON(), 'mention')?.attrs).toEqual({ userId: '42', name: '田中' });
  });
});

function findNode(node: JSONContent, type: string): JSONContent | undefined {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}
