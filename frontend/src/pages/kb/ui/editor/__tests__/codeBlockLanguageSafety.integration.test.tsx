import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
/*
 * language は class 名にそのまま埋め込まれる（"language-" + language）ため、
 * 空白混じりの値（攻撃例: "go fixed inset-0 z-50 bg-white" のような Tailwind の
 * 位置指定クラスで画面を覆う偽装オーバーレイ）を通すと任意の class を足せてしまう。
 * この形の doc は API を直接叩けば作れる（backend の page_usecase.go は保存時に
 * 同じ許可リストで検査・正規化するが、フロント側にも独立した防御線が要る）。
 *
 * 貼り付け（経路2）は DOM の classList を経由するため空白混じりの値そのものは作れないが、
 * 許可リストに無い言語名（正規の 1 トークン）を通してしまわないことは別に確かめる価値がある。
 * NodeView の描画（編集画面での通常の見た目）は codeBlock.integration.test.tsx 側で確認済みなので、
 * ここでは NodeView を経由しない経路（貼り付け・editor.getHTML()）を
 * link.integration.test.tsx と同じ構成で確かめる。
 */

let editor: Editor | null = null;

function makeEditor(content: JSONContent = emptyRichDoc()): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  return editor;
}

const pasteEvent = () => new Event('paste') as ClipboardEvent;

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('経路2: ペースト', () => {
  // 貼り付けは DOM の classList を経由するため、class 属性の中に空白を混ぜても
  // ブラウザ（jsdom）が別々のトークンへ割ってしまい、"language-" 接頭辞の 1 トークンだけが
  // 拾われる（＝空白混じりの値そのものは貼り付け経路では作れない）。ここで確かめるのは、
  // その 1 トークンが許可リストに無い場合に plaintext へ丸められることの方。
  it('許可リストに無い言語で貼り付けると plaintext へ丸められる', () => {
    const e = makeEditor();
    e.commands.focus('end');
    e.view.pasteHTML('<pre><code class="language-brainfuck">rm -rf /</code></pre>', pasteEvent());
    const codeBlock = e.getJSON().content?.find((n) => n.type === 'codeBlock');
    expect(codeBlock?.attrs?.language).toBe('plaintext');
  });

  it('許可リストにある言語はそのまま通る', () => {
    const e = makeEditor();
    e.commands.focus('end');
    e.view.pasteHTML('<pre><code class="language-go">package main</code></pre>', pasteEvent());
    const codeBlock = e.getJSON().content?.find((n) => n.type === 'codeBlock');
    expect(codeBlock?.attrs?.language).toBe('go');
  });
});

describe('経路3: editor.getHTML()（NodeView を経由しないシリアライズ）', () => {
  it('許可リストに無い language は書き出す HTML の class から落ちる', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'codeBlock',
          attrs: { language: 'go fixed inset-0 z-50 bg-white' },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    });
    const html = e.getHTML();
    expect(html).not.toContain('fixed');
    expect(html).not.toContain('inset-0');
  });

  it('許可リストにある言語は書き出す HTML の class に残る', () => {
    const e = makeEditor({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: 'go' }, content: [{ type: 'text', text: 'x' }] }],
    });
    expect(e.getHTML()).toContain('language-go');
  });

  it('language が未設定なら class を付けない（既定の挙動を変えない）', () => {
    const e = makeEditor({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: 'x' }] }],
    });
    expect(e.getHTML()).not.toContain('language-');
  });
});
