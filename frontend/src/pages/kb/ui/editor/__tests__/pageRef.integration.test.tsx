import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';

/*
 * ページ参照（pageRef）は「題名がリンク先に追従するインラインの 1 要素」。
 * 題名の正本はサーバーが読み出し時に解決するので、ここで確かめるのは描画の契約:
 * 正しい ID はページへのリンクになり、怪しい ID はリンクにしない（atom として往復する）。
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

/**
 * pasteEvent は貼り付け経路用のダミーイベント。jsdom には ClipboardEvent が無いため、
 * prosemirror-view の pasteHTML へ明示的に渡す（渡さないと内部で生成して落ちる）。
 */
const pasteEvent = () => new Event('paste') as ClipboardEvent;

function docWithRef(pageId: unknown, title: string | null = '設計メモ'): JSONContent {
  return {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'pageRef', attrs: { pageId, title } }] },
    ],
  };
}

describe('ページ参照（pageRef）', () => {
  it('正しい ID は /kb/{id} へのリンクとして描画され、題名が文字になる', () => {
    const e = makeEditor(docWithRef(uuid));

    const html = e.getHTML();
    expect(html).toContain(`href="/kb/${uuid}"`);
    expect(html).toContain('data-page-ref');
    expect(html).toContain('設計メモ');
    // 内部リンクなので _blank / rel の束（外部向けの防御）は付けない。
    expect(html).not.toContain('_blank');
    expect(e.getText()).toContain('設計メモ');
  });

  it('UUID の形でない ID はリンクにしない（押せるのにどこへも行かない要素も作らない）', () => {
    const e = makeEditor(docWithRef('javascript:alert(1)'));

    const html = e.getHTML();
    expect(html).not.toContain('href');
    expect(html).toContain('data-page-ref');
  });

  it('題名が無い参照は「ページ」と表示する（空の要素にしない）', () => {
    const e = makeEditor(docWithRef(uuid, null));

    expect(e.getHTML()).toContain('ページ');
  });

  it('描画した HTML を貼り直しても参照のまま戻る（コピー＆ペーストで劣化しない）', () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });

    e.view.pasteHTML(
      `<p><a data-page-ref="true" data-page-id="${uuid}" href="/kb/${uuid}">設計メモ</a></p>`,
      pasteEvent(),
    );

    const json = JSON.stringify(e.getJSON());
    expect(json).toContain(`"pageId":"${uuid}"`);
    // リンクマークに劣化していない（pageRef ノードとして入っている）。
    expect(json).toContain('"pageRef"');
    expect(json).not.toContain('"link"');
  });

  it('偽の data-page-id を持つ HTML は参照として取り込まない', () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph' }] });

    e.view.pasteHTML(
      '<p><a data-page-ref="true" data-page-id="javascript:alert(1)" href="/x">押して</a></p>',
      pasteEvent(),
    );

    const json = JSON.stringify(e.getJSON());
    expect(json).not.toContain('pageRef');
    expect(json).not.toContain('javascript:alert(1)');
    // 文字は残る（読み手から本文が消えない）。
    expect(e.getText()).toContain('押して');
  });

  it('doc JSON として往復する（保存 → 再読込で参照が消えない）', () => {
    const e = makeEditor(docWithRef(uuid));
    const saved = e.getJSON();

    const reloaded = makeEditor(saved);
    const html = reloaded.getHTML();
    expect(html).toContain(`href="/kb/${uuid}"`);
    expect(JSON.stringify(reloaded.getJSON())).toContain(`"pageId":"${uuid}"`);
  });
});
