import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import RichTextEditor from '../RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';

// 重い描画の道具（KaTeX・mermaid）は読まず、描いた結果だけを返す偽物にする。
// 読めない式の例として `\bad` を使う。
vi.mock('../lazyRenderers', () => ({
  renderMath: vi.fn(async (latex: string, display: boolean) =>
    latex.includes('\\bad')
      ? { error: 'Undefined control sequence: \\bad' }
      : { html: `<span class="katex${display ? ' katex-display' : ''}">${latex}</span>` },
  ),
  renderDiagram: vi.fn(async () => ({ svg: '<svg></svg>' })),
}));

let editor: Editor | null = null;

afterEach(() => {
  cleanup();
  editor = null;
});

async function mount(value: RichDocContent, editable = true): Promise<Editor> {
  render(
    <RichTextEditor
      value={value}
      editable={editable}
      onChange={() => {}}
      onCreate={(created) => {
        editor = created;
      }}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return editor as Editor;
}

const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content });
const text = (value: string): JSONContent => ({ type: 'text', text: value });
const doc = (...content: JSONContent[]): RichDocContent => ({ type: 'doc', content });

/** typeText は入力規則を発火させるため、キー入力と同じ経路（handleTextInput）で 1 文字ずつ打つ。 */
function typeText(e: Editor, value: string) {
  for (const ch of value) {
    act(() => {
      const { from, to } = e.state.selection;
      const handled = e.view.someProp('handleTextInput', (f) => f(e.view, from, to, ch));
      if (!handled) e.view.dispatch(e.state.tr.insertText(ch, from, to));
    });
  }
}

function findNodes(node: JSONContent, type: string): JSONContent[] {
  const found: JSONContent[] = [];
  const walk = (n: JSONContent) => {
    if (n.type === type) found.push(n);
    n.content?.forEach(walk);
  };
  walk(node);
  return found;
}

function posOf(e: Editor, type: string): number {
  let pos = -1;
  e.state.doc.descendants((node, nodePos) => {
    if (pos === -1 && node.type.name === type) pos = nodePos;
    return pos === -1;
  });
  return pos;
}

describe('数式の描画', () => {
  it('行内の数式と行の数式を、描画の口が返した HTML で出す', async () => {
    const e = await mount(
      doc(paragraph(text('式 '), { type: 'inlineMath', attrs: { latex: 'a^2' } }), {
        type: 'blockMath',
        attrs: { latex: '\\sum i' },
      }),
    );
    await waitFor(() => expect(e.view.dom.querySelectorAll('.katex')).toHaveLength(2));
    expect(e.view.dom.querySelector('.rte-math-inline .katex')?.textContent).toBe('a^2');
    expect(e.view.dom.querySelector('.rte-math-block .katex-display')?.textContent).toBe('\\sum i');
  });

  it('読めない式は、理由と元の式を出す', async () => {
    const e = await mount(doc({ type: 'blockMath', attrs: { latex: '\\bad x' } }));
    await waitFor(() => expect(screen.getByText(/数式を読めません/)).toBeInTheDocument());
    expect(screen.getByText(/Undefined control sequence/)).toBeInTheDocument();
    expect(e.view.dom.querySelector('.rte-math-error code')?.textContent).toBe('\\bad x');
  });

  it('空の行の数式は入力の案内を出す', async () => {
    await mount(doc({ type: 'blockMath', attrs: { latex: '' } }));
    expect(await screen.findByText('数式を入力（LaTeX）')).toBeInTheDocument();
  });
});

describe('数式の入力規則', () => {
  it('$a^2$ と打ち終えると行内の数式になる', async () => {
    const e = await mount(doc(paragraph()));
    act(() => {
      e.commands.focus('end');
    });
    typeText(e, '式は $a^2$');
    expect(findNodes(e.getJSON(), 'inlineMath').map((n) => n.attrs?.latex)).toEqual(['a^2']);
    expect(e.getText()).toBe('式は a^2');
  });

  it.each([
    ['閉じの $ の前に空白がある（金額）', '$5 と $'],
    ['開きの $ の後ろに空白がある', '$ x$'],
    ['\\$ は文字としての $', '\\$x$'],
  ])('%s ときは変換しない', async (_label, typed) => {
    const e = await mount(doc(paragraph()));
    act(() => {
      e.commands.focus('end');
    });
    typeText(e, typed);
    expect(findNodes(e.getJSON(), 'inlineMath')).toHaveLength(0);
    expect(e.getText()).toBe(typed);
  });

  it('空の段落で $$ と空白を打つと行の数式になり、入力欄が開く', async () => {
    const e = await mount(doc(paragraph(text('前')), paragraph()));
    act(() => {
      e.commands.focus('end');
    });
    typeText(e, '$$ ');
    expect(findNodes(e.getJSON(), 'blockMath')).toHaveLength(1);
    expect(e.state.selection).toBeInstanceOf(NodeSelection);
    expect(await screen.findByRole('textbox', { name: '数式（LaTeX）' })).toBeInTheDocument();
  });

  it('文の途中の $$ は行の数式にしない', async () => {
    const e = await mount(doc(paragraph()));
    act(() => {
      e.commands.focus('end');
    });
    typeText(e, '前 $$ ');
    expect(findNodes(e.getJSON(), 'blockMath')).toHaveLength(0);
  });
});

describe('数式の編集', () => {
  it('入力欄で式を書き換えると latex が変わり、Esc で閉じて数式の後ろへ戻る', async () => {
    const e = await mount(doc({ type: 'blockMath', attrs: { latex: 'x' } }, paragraph(text('後'))));
    act(() => {
      e.commands.setNodeSelection(posOf(e, 'blockMath'));
    });
    fireEvent.click(e.view.dom.querySelector('[data-math-view]')!);
    const input = await screen.findByRole('textbox', { name: '数式（LaTeX）' });
    fireEvent.change(input, { target: { value: 'x^2' } });
    expect(findNodes(e.getJSON(), 'blockMath')[0].attrs?.latex).toBe('x^2');
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '数式（LaTeX）' })).toBeNull());
    expect(e.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(e.state.selection.from).toBeGreaterThan(posOf(e, 'blockMath'));
  });

  it('数式を選んで Enter を押すと入力欄が開く（矢印で選んだだけでは開かない）', async () => {
    const e = await mount(doc(paragraph(text('式 '), { type: 'inlineMath', attrs: { latex: 'a' } })));
    act(() => {
      e.commands.setNodeSelection(posOf(e, 'inlineMath'));
    });
    expect(screen.queryByRole('textbox', { name: '数式（LaTeX）' })).toBeNull();
    act(() => {
      e.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    });
    expect(await screen.findByRole('textbox', { name: '数式（LaTeX）' })).toBeInTheDocument();
    // 改行にはならない（段落は 1 つのまま）。
    expect(e.getJSON().content?.filter((n) => n.type === 'paragraph')).toHaveLength(1);
  });

  it('閲覧モードでは選んで押しても入力欄を開かない', async () => {
    const e = await mount(doc({ type: 'blockMath', attrs: { latex: 'x' } }), false);
    act(() => {
      e.commands.setNodeSelection(posOf(e, 'blockMath'));
    });
    fireEvent.click(e.view.dom.querySelector('[data-math-view]')!);
    expect(screen.queryByRole('textbox', { name: '数式（LaTeX）' })).toBeNull();
  });
});

describe('数式と図の命令', () => {
  it("'/' の「数式」は空の段落を行の数式に置き換え、入力欄を開く", async () => {
    const e = await mount(doc(paragraph(text('前')), paragraph()));
    act(() => {
      e.commands.focus('end');
      e.commands.insertBlockMath();
    });
    expect(e.getJSON().content?.map((n) => n.type)).toEqual(['paragraph', 'blockMath', 'paragraph']);
    expect(await screen.findByRole('textbox', { name: '数式（LaTeX）' })).toBeInTheDocument();
  });

  it('行内の数式は文の中に入り、コードの中では入れられない', async () => {
    const e = await mount(doc(paragraph(text('前')), { type: 'codeBlock', content: [text('code')] }));
    act(() => {
      // 「前」の末尾（段落の中）。
      e.commands.setTextSelection(2);
    });
    expect(e.can().insertInlineMath()).toBe(true);
    act(() => {
      e.commands.setTextSelection(e.state.doc.content.size - 2);
    });
    expect(e.can().insertInlineMath()).toBe(false);
  });

  it('折りたたみの要約の中には行の数式も図も入れられない', async () => {
    const e = await mount(
      doc({
        type: 'details',
        attrs: { open: true },
        content: [
          { type: 'detailsSummary', content: [text('要約')] },
          { type: 'detailsContent', content: [paragraph(text('中身'))] },
        ],
      }),
    );
    act(() => {
      e.commands.setTextSelection(3);
    });
    expect(e.state.selection.$from.parent.type.name).toBe('detailsSummary');
    expect(e.can().insertBlockMath()).toBe(false);
    expect(e.can().insertDiagram()).toBe(false);
    expect(e.can().insertInlineMath()).toBe(false);
  });
});
