import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { Editor, type JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { activeLinkHref, applyLink, removeLink } from '../editorCommands';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc, type RichDocContent } from '@/shared/lib/richDoc';
/*
 * リンクの XSS 対策は「入力」「貼り付け」「保存・再読込の往復」の 3 経路すべてで塞いで
 * はじめて意味を持つ。1 つでも空いていれば、そこから危険な href が doc に入り込み、
 * 残りの防御はすり抜けられる。このファイルは 3 経路を 1 つずつ突いて確かめる。
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

/**
 * pasteEvent は貼り付け経路用のダミーイベント。jsdom には ClipboardEvent が無いため、
 * prosemirror-view の pasteHTML / pasteText へ明示的に渡す（渡さないと内部で生成して落ちる）。
 */
const pasteEvent = () => new Event('paste') as ClipboardEvent;

/** linkHrefs は doc JSON を歩いて link マークの href を文書順に集める。 */
function linkHrefs(doc: JSONContent): unknown[] {
  const found: unknown[] = [];
  const walk = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      if (mark.type === 'link') found.push(mark.attrs?.href);
    }
    (node.content ?? []).forEach(walk);
  };
  walk(doc);
  return found;
}

/** plainText は doc JSON の text を連結する（マークを外しても文字が残ることの確認用）。 */
function plainText(doc: JSONContent): string {
  let out = '';
  const walk = (node: JSONContent) => {
    if (typeof node.text === 'string') out += node.text;
    (node.content ?? []).forEach(walk);
  };
  walk(doc);
  return out;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('経路1: 入力（打ち込み・autolink）', () => {
  it('URL を打って空白で区切ると自動でリンクになる', () => {
    const e = makeEditor();
    e.commands.focus('end');
    typeText(e, 'https://example.com ');
    expect(linkHrefs(e.getJSON())).toEqual(['https://example.com']);
  });

  it('`[文字](URL)` の記法で打ってもリンクになる', () => {
    const e = makeEditor();
    e.commands.focus('end');
    typeText(e, '[公式](https://example.com)');
    expect(linkHrefs(e.getJSON())).toEqual(['https://example.com']);
    expect(plainText(e.getJSON())).toBe('公式');
  });

  it('`javascript:` を打ち込んでもリンクにならない（文字はそのまま残る）', () => {
    const e = makeEditor();
    e.commands.focus('end');
    typeText(e, '[押して](javascript:alert(1))');
    expect(linkHrefs(e.getJSON())).toEqual([]);
    expect(plainText(e.getJSON())).toContain('javascript:alert(1)');
  });

  it('許可外スキーム（data: / vbscript: / ftp:）も打ち込みでリンクにならない', () => {
    for (const href of ['data:text/html,<script>1</script>', 'vbscript:msgbox(1)', 'ftp://x.example']) {
      const e = makeEditor();
      e.commands.focus('end');
      typeText(e, `[押して](${href})`);
      expect(linkHrefs(e.getJSON()), href).toEqual([]);
      e.destroy();
    }
    editor = null;
  });
});

describe('経路2: ペースト', () => {
  it('HTML を貼り付けると許可スキームのリンクだけが残る', () => {
    const e = makeEditor();
    e.commands.focus('end');
    e.view.pasteHTML(
      '<p><a href="javascript:alert(1)">危険</a> / <a href="https://ok.example">安全</a></p>',
      pasteEvent(),
    );
    expect(linkHrefs(e.getJSON())).toEqual(['https://ok.example']);
    // 危険なリンクはマークだけ外し、文字は消さない。
    expect(plainText(e.getJSON())).toContain('危険');
  });

  it('HTML の rel / target を細工しても doc には保存されない（描画時に固定する）', () => {
    const e = makeEditor();
    e.commands.focus('end');
    e.view.pasteHTML('<a href="https://ok.example" rel="" target="_self">x</a>', pasteEvent());
    const marks = e.getJSON().content?.[0]?.content?.[0]?.marks;
    expect(marks).toEqual([{ type: 'link', attrs: { href: 'https://ok.example', title: null } }]);
    expect(e.getHTML()).toContain('rel="noopener noreferrer nofollow"');
    expect(e.getHTML()).toContain('target="_blank"');
  });

  it('テキストの URL を貼り付けるとリンクになる', () => {
    const e = makeEditor();
    e.commands.focus('end');
    e.view.pasteText('参考 https://example.com/a です', pasteEvent());
    expect(linkHrefs(e.getJSON())).toEqual(['https://example.com/a']);
  });

  it('テキストで `[文字](javascript:…)` を貼り付けてもリンクにならない', () => {
    const e = makeEditor();
    e.commands.focus('end');
    e.view.pasteText('[押して](javascript:alert(1))', pasteEvent());
    expect(linkHrefs(e.getJSON())).toEqual([]);
  });

  it('タブでスキームを割った href を貼り付けても弾く', () => {
    const e = makeEditor();
    e.commands.focus('end');
    e.view.pasteHTML('<a href="java&#9;script:alert(1)">x</a>', pasteEvent());
    expect(linkHrefs(e.getJSON())).toEqual([]);
  });
});

describe('経路3: 保存・再読込の往復', () => {
  const poisonedDoc: RichDocContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '押して', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] },
        ],
      },
    ],
  };

  // エディタが getJSON で出すのと同じ形（link の attrs は href / title だけ）。
  // target / rel はここに現れない ＝ doc に保存されない（描画時に固定で付ける）。
  const safeDoc: RichDocContent = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '公式',
            marks: [{ type: 'link', attrs: { href: 'https://ok.example', title: null } }],
          },
        ],
      },
    ],
  };

  it('危険な href を含む doc を読み込むと、そのままでは <a> にならない', async () => {
    const { container } = render(<RichTextEditor value={poisonedDoc} />);
    await waitFor(() => expect(container.querySelector('.ProseMirror')).not.toBeNull());
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('押して');
  });

  it('危険な href を含む doc は、外へ渡す値（＝保存される値）から取り除かれる', async () => {
    const onChange = vi.fn();
    render(<RichTextEditor value={poisonedDoc} onChange={onChange} />);
    // 読み込み時点で洗った doc が現在値になるため、そのずれが onChange として外へ出る。
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const emitted = onChange.mock.calls.at(-1)?.[0] as RichDocContent;
    expect(linkHrefs(emitted)).toEqual([]);
    expect(plainText(emitted)).toBe('押して');
  });

  it('安全なリンクは読み込み・保存の往復で保たれる', async () => {
    const onChange = vi.fn();
    const { container } = render(<RichTextEditor value={safeDoc} onChange={onChange} />);
    await waitFor(() => expect(container.querySelector('a')).not.toBeNull());
    const anchor = container.querySelector('a');
    expect(anchor?.getAttribute('href')).toBe('https://ok.example');
    expect(anchor?.getAttribute('rel')).toBe('noopener noreferrer nofollow');
    expect(anchor?.getAttribute('target')).toBe('_blank');
    // 外へ渡る値（＝保存される値）が発生した場合も、安全なリンクは落とさない
    //（洗浄の対象は許可できない href だけ）。
    for (const call of onChange.mock.calls) {
      expect(linkHrefs(call[0] as RichDocContent)).toEqual(['https://ok.example']);
    }
  });

  it('エディタが出した doc をもう一度読み込んでもリンクが保たれる（保存 → 再読込）', () => {
    const first = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '公式' }] }] });
    first.commands.setTextSelection({ from: 1, to: 3 });
    expect(applyLink(first, 'https://ok.example')).toBe(true);
    const saved = first.getJSON();
    first.destroy();

    const reloaded = makeEditor(saved);
    expect(linkHrefs(reloaded.getJSON())).toEqual(['https://ok.example']);
    expect(reloaded.getHTML()).toContain('href="https://ok.example"');
  });
});

describe('選択範囲へのリンク設定・解除', () => {
  const textDoc: JSONContent = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'こちらの資料' }] }],
  };

  it('選択範囲にリンクを掛けられる（スキーム省略時は https:// を補う）', () => {
    const e = makeEditor(textDoc);
    e.commands.setTextSelection({ from: 1, to: 4 });
    expect(applyLink(e, 'example.com/a')).toBe(true);
    expect(linkHrefs(e.getJSON())).toEqual(['https://example.com/a']);
    expect(activeLinkHref(e)).toBe('https://example.com/a');
  });

  it('掛けたリンクを解除できる（文字は残る）', () => {
    const e = makeEditor(textDoc);
    e.commands.setTextSelection({ from: 1, to: 4 });
    applyLink(e, 'https://ok.example');
    expect(removeLink(e)).toBe(true);
    expect(linkHrefs(e.getJSON())).toEqual([]);
    expect(plainText(e.getJSON())).toBe('こちらの資料');
  });

  it('許可できない URL は掛からず false を返す', () => {
    const e = makeEditor(textDoc);
    e.commands.setTextSelection({ from: 1, to: 4 });
    expect(applyLink(e, 'javascript:alert(1)')).toBe(false);
    expect(linkHrefs(e.getJSON())).toEqual([]);
    expect(activeLinkHref(e)).toBeNull();
  });

  it('リンクの中にキャレットを置くだけで URL を貼り替えられる', () => {
    const e = makeEditor(textDoc);
    e.commands.setTextSelection({ from: 1, to: 4 });
    applyLink(e, 'https://old.example');
    e.commands.setTextSelection({ from: 2, to: 2 });
    expect(applyLink(e, 'https://new.example')).toBe(true);
    expect(linkHrefs(e.getJSON())).toEqual(['https://new.example']);
  });
});
