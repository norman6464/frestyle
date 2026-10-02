import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { openClickedLink } from '../linkClick';

/*
 * チケット参照（ticketRef）は「鍵・題名・状態がチケットに追従するインラインの 1 要素」。
 * 写しの正本はサーバーが読み出し時に解決するので、ここで確かめるのは描画の契約:
 * 解決された参照は鍵・題名・状態の札でチケットへのリンクになり、解決されていない参照は
 * 「チケット」とだけ出してどこへも行かない。怪しい ID はリンクにしない（atom として往復する）。
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

const uuid = '01a046a3-cf95-73f3-bd0e-1eb9b08eb1d4';

const pasteEvent = () => new Event('paste') as ClipboardEvent;

const resolvedAttrs = {
  ticketId: uuid,
  key: 'ENG-12',
  title: 'ログインが落ちる',
  statusName: '進行中',
  statusCategory: 'in_progress',
};

function docWithRef(attrs: Record<string, unknown>): JSONContent {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'ticketRef', attrs }] }],
  };
}

describe('チケット参照（ticketRef）', () => {
  it('解決された参照は /tickets/{id} へのリンクになり、鍵・題名・状態が文字になる', () => {
    const e = makeEditor(docWithRef(resolvedAttrs));

    const html = e.getHTML();
    expect(html).toContain(`href="/tickets/${uuid}"`);
    expect(html).toContain('data-ticket-ref');
    expect(html).toContain('ENG-12');
    expect(html).toContain('ログインが落ちる');
    expect(html).toContain('進行中');
    expect(html).toContain('is-in_progress');
    // 内部リンクなので _blank / rel の束（外部向けの防御）は付けない。
    expect(html).not.toContain('_blank');
    expect(e.getText()).toContain('ENG-12 ログインが落ちる');
  });

  it('解決されていない参照（写しが無い）は「チケット」とだけ出し、リンクにしない', () => {
    // 読み手がバックログを見られないとき・版のプレビュー・提案の表示では写しが無い。
    // 押しても 404 になる先へ誘わない（押せるのにどこへも行かない要素を作らない）。
    const e = makeEditor(docWithRef({ ticketId: uuid, key: null, title: null, statusName: null, statusCategory: null }));

    const html = e.getHTML();
    expect(html).not.toContain('<a');
    expect(html).toContain('チケット');
    expect(html).toContain('is-unresolved');
    expect(e.getText()).toContain('チケット');
  });

  it('UUID の形でない ID はリンクにしない', () => {
    const e = makeEditor(docWithRef({ ...resolvedAttrs, ticketId: 'javascript:alert(1)' }));

    const html = e.getHTML();
    expect(html).not.toContain('<a');
    expect(html).not.toContain('javascript:');
    expect(html).toContain('ENG-12');
  });

  it('知らない状態の枠は印を付けない（未知の値を class に流さない）', () => {
    const e = makeEditor(docWithRef({ ...resolvedAttrs, statusCategory: 'bogus' }));
    const html = e.getHTML();
    expect(html).not.toContain('is-bogus');
    expect(html).toContain('進行中');
  });

  it('描画した HTML を貼り直しても参照のまま戻る（コピー＆ペーストで劣化しない）', () => {
    const source = makeEditor(docWithRef(resolvedAttrs));
    const html = source.getHTML();
    source.destroy();

    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
    e.view.pasteHTML(html, pasteEvent());

    const ref = findNode(e.getJSON(), 'ticketRef');
    expect(ref?.attrs).toEqual(resolvedAttrs);
  });

  it('偽の data-ticket-id を持つ HTML は参照として取り込まない', () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });
    e.view.pasteHTML(
      '<a data-ticket-ref="true" data-ticket-id="javascript:alert(1)" href="/tickets/x">ENG-1 偽物</a>',
      pasteEvent(),
    );
    expect(findNode(e.getJSON(), 'ticketRef')).toBeUndefined();
    expect(e.getText()).toContain('ENG-1 偽物');
  });

  it('doc JSON として往復する（保存 → 再読込で参照が消えない）', () => {
    const e = makeEditor(docWithRef(resolvedAttrs));
    const json = e.getJSON();
    expect(findNode(json, 'ticketRef')?.attrs).toEqual(resolvedAttrs);
  });

  it('札を押すとアプリ内でチケットへ遷移する（修飾キーなら新しいタブ）', () => {
    const e = makeEditor(docWithRef(resolvedAttrs));
    document.body.appendChild(e.view.dom);
    const anchor = e.view.dom.querySelector('a[data-ticket-ref]');
    expect(anchor).not.toBeNull();
    const navigate = vi.fn();
    const event = new MouseEvent('click', { bubbles: true });
    Object.defineProperty(event, 'target', { value: anchor });
    expect(openClickedLink(event, navigate, { editable: true })).toBe(true);
    expect(navigate).toHaveBeenCalledWith(`/tickets/${uuid}`);
    e.view.dom.remove();
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
