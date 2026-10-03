import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';
import { renderDiagram } from '../lazyRenderers';
import { DEFAULT_DIAGRAM_SOURCE } from '../mathAndDiagram';

// mermaid は SVG の寸法の計算に本物のブラウザが要るので、ここでは描いた結果だけを返す偽物にする
// （本物の描画は Storybook の見本で確かめる）。`oops` を含む書式は描けない例。
vi.mock('../lazyRenderers', () => ({
  renderMath: vi.fn(async () => ({ html: '' })),
  renderDiagram: vi.fn(async (source: string) =>
    source.includes('oops')
      ? { error: 'Parse error on line 1' }
      : { svg: `<svg data-testid="diagram-svg"><text>${source.length}</text></svg>` },
  ),
}));

let editor: Editor | null = null;

beforeEach(() => {
  vi.mocked(renderDiagram).mockClear();
});

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

const diagram = (source: string): JSONContent => ({
  type: 'diagram',
  attrs: { engine: 'mermaid' },
  content: source === '' ? [] : [{ type: 'text', text: source }],
});
const doc = (...content: JSONContent[]): RichDocContent => ({ type: 'doc', content });

describe('図', () => {
  it('描画の口が返した SVG を右に出し、編集中は元の文字も出す', async () => {
    const e = await mount(doc(diagram('graph TD; A-->B')));
    expect(await screen.findByTestId('diagram-svg')).toBeInTheDocument();
    expect(renderDiagram).toHaveBeenCalledWith('graph TD; A-->B');
    const view = e.view.dom.querySelector('.rte-diagram-view');
    expect(view).toHaveClass('is-editable');
    expect(view?.querySelector('.rte-diagram-source code')?.textContent).toBe('graph TD; A-->B');
  });

  it('描けない書式のときは、図の代わりに理由を出す', async () => {
    await mount(doc(diagram('graph oops')));
    expect(await screen.findByText(/図を描けません（Parse error on line 1）/)).toBeInTheDocument();
    expect(screen.queryByTestId('diagram-svg')).toBeNull();
  });

  it('閲覧モードでは元の文字を出さない（図だけ）', async () => {
    const e = await mount(doc(diagram('graph TD; A-->B')), false);
    expect(await screen.findByTestId('diagram-svg')).toBeInTheDocument();
    expect(e.view.dom.querySelector('.rte-diagram-view')).not.toHaveClass('is-editable');
  });

  it('描き直しても、描いた図の要素は作り直さない（元の文字を打つたびにちらつかない）', async () => {
    const e = await mount(doc(diagram('graph TD; A-->B'), { type: 'paragraph' }));
    const before = await screen.findByTestId('diagram-svg');
    act(() => {
      e.commands.setNodeSelection(0);
    });
    await waitFor(() => expect(e.view.dom.querySelector('.ProseMirror-selectednode')).not.toBeNull());
    expect(screen.getByTestId('diagram-svg')).toBe(before);
  });

  it('空の図は描画の口を呼ばず、書き方の案内を出す', async () => {
    await mount(doc(diagram('')));
    expect(await screen.findByText(/図の書式（mermaid）を左に書くと/)).toBeInTheDocument();
    expect(renderDiagram).not.toHaveBeenCalled();
  });

  it("'/' の「図」は空の段落を見本の図に置き換え、元の文字の末尾にカーソルを置く", async () => {
    const e = await mount(doc({ type: 'paragraph' }));
    act(() => {
      e.commands.focus('end');
      e.commands.insertDiagram();
    });
    const node = e.state.doc.child(0);
    expect(node.type.name).toBe('diagram');
    expect(node.textContent).toBe(DEFAULT_DIAGRAM_SOURCE);
    expect(e.state.selection.$from.parent.type.name).toBe('diagram');
    expect(e.state.selection.$from.parentOffset).toBe(DEFAULT_DIAGRAM_SOURCE.length);
    expect(await screen.findByTestId('diagram-svg')).toBeInTheDocument();
  });
});
