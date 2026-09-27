import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '../emptyRichDoc';

// 作ったエディタはすべて覚えて、後片付けで全部壊す。1 つのテストで 2 つ作ったとき、変数 1 つに
// 上書きして持つと 1 つ目が壊されずに残り、そのタイマー（prosemirror の選択・変更の監視）が
// テストの環境を片付けたあとに走って document に触れ、テストの外でエラーになる。
const editors: Editor[] = [];

function makeEditor(content: JSONContent = emptyRichDoc()): Editor {
  const editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content,
  });
  editors.push(editor);
  return editor;
}

/**
 * typeConfirmed は IME の変換確定と同じ経路（handleTextInput を経ない doc 変化）で
 * テキストを入力する。input rule は発火せず、appendTransaction（MarkdownShortcuts）だけが働く。
 */
function typeConfirmed(e: Editor, text: string) {
  e.chain().focus('end').insertContent(text).run();
}

const firstNode = (e: Editor) => e.getJSON().content?.[0];

afterEach(() => {
  for (const editor of editors.splice(0)) {
    if (!editor.isDestroyed) editor.destroy();
  }
});

describe('MarkdownShortcuts（IME 確定経路でも効く変換）', () => {
  it.each([
    ['＃ ', 1],
    ['＃＃ ', 2],
    ['＃＃＃ ', 3],
    ['# ', 1],
    ['＃# ', 2],
  ])('確定入力 %s で見出し%i になる', (text, level) => {
    const e = makeEditor();
    typeConfirmed(e, text);
    expect(firstNode(e)?.type).toBe('heading');
    expect(firstNode(e)?.attrs?.level).toBe(level);
  });

  it('全角スペース確定（＃＃　）でも見出し2になる', () => {
    const e = makeEditor();
    typeConfirmed(e, '＃＃　');
    expect(firstNode(e)?.type).toBe('heading');
    expect(firstNode(e)?.attrs?.level).toBe(2);
  });

  it('``` でコードブロックになる（言語なし）', () => {
    const e = makeEditor();
    typeConfirmed(e, '``` ');
    expect(firstNode(e)?.type).toBe('codeBlock');
    expect(firstNode(e)?.attrs?.language ?? null).toBeNull();
  });

  it('```sql で言語付きコードブロックになる', () => {
    const e = makeEditor();
    typeConfirmed(e, '```sql ');
    expect(firstNode(e)?.type).toBe('codeBlock');
    expect(firstNode(e)?.attrs?.language).toBe('sql');
  });

  it('全角 ｀｀｀ でもコードブロックになる', () => {
    const e = makeEditor();
    typeConfirmed(e, '｀｀｀ ');
    expect(firstNode(e)?.type).toBe('codeBlock');
  });

  it('本文が続く行では変換しない（# の後に文章）', () => {
    const e = makeEditor();
    typeConfirmed(e, '# 見出しではない本文');
    expect(firstNode(e)?.type).toBe('paragraph');
  });

  it('スペースで確定しなければ変換しない', () => {
    const e = makeEditor();
    typeConfirmed(e, '＃＃');
    expect(firstNode(e)?.type).toBe('paragraph');
  });

  it('既存の見出し・コードブロック内では暴発しない', () => {
    const e = makeEditor({
      type: 'doc',
      content: [{ type: 'codeBlock', attrs: { language: null }, content: [{ type: 'text', text: '```' }] }],
    });
    typeConfirmed(e, ' ');
    // codeBlock の中はそのまま（段落だけが変換対象）。
    expect(firstNode(e)?.type).toBe('codeBlock');
    expect(firstNode(e)?.content?.[0]?.text).toBe('``` ');
  });
});

describe('MarkdownShortcuts（公開 UI・IME 状態の検証）', () => {
  it('公開 UI（RichTextEditor）経由でも確定入力で見出しになる（role=textbox で検証）', async () => {
    const { render, screen, waitFor, act } = await import('@testing-library/react');
    const { default: RichTextEditor } = await import('../RichTextEditor');
    let created: Editor | null = null;
    render(<RichTextEditor value={emptyRichDoc()} ariaLabel="メモ本文" onCreate={(e) => { created = e; }} />);
    await waitFor(() => expect(created).not.toBeNull());
    // アクセシブルな編集領域として公開されていること。
    expect(screen.getByRole('textbox', { name: 'メモ本文' })).toBeInTheDocument();
    act(() => {
      created!.chain().focus('end').insertContent('＃＃ ').run();
    });
    await waitFor(() => {
      const first = created!.getJSON().content?.[0];
      expect(first?.type).toBe('heading');
      expect(first?.attrs?.level).toBe(2);
    });
    // 見出しが DOM にも h2 として現れる。
    expect(document.querySelector('.ProseMirror h2')).not.toBeNull();
  });

  it('IME 変換中（composing）は変換せず、確定後の入力で変換される', () => {
    const e = makeEditor();
    const input = e.view.input as unknown as { composing: boolean };

    // 変換中: プレビュー分の doc 変化（＃ とスペース）が入っても段落のまま。
    input.composing = true;
    expect(e.view.composing).toBe(true);
    typeConfirmed(e, '＃ ');
    expect(firstNode(e)?.type).toBe('paragraph');

    // 確定後: composing が解け、その後の doc 変化（IME で ＃ 確定 → スペース打鍵）で変換される。
    input.composing = false;
    const e2 = makeEditor();
    (e2.view.input as unknown as { composing: boolean }).composing = true;
    typeConfirmed(e2, '＃');           // 変換中に ＃（変換されない）
    (e2.view.input as unknown as { composing: boolean }).composing = false;
    typeConfirmed(e2, ' ');            // 確定後にスペース → この doc 変化で変換
    expect(firstNode(e2)?.type).toBe('heading');
    expect(firstNode(e2)?.attrs?.level).toBe(1);
    e2.destroy();
  });
});
