import { describe, it, expect, afterEach, beforeAll, afterAll } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor, JSONContent } from '@tiptap/react';
import RichTextEditor, { type RichTextEditorProps } from '../RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';

const ID = 'dQw4w9WgXcQ';
let editor: Editor | null = null;

afterEach(() => {
  cleanup();
  editor = null;
});

// jsdom は Range/Element の getClientRects・coordsAtPos に要る矩形を持たない（slashCommand の結合テストと同じ手当て）。
const zeroRect = { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, toJSON: () => ({}) } as DOMRect;
const original = {
  range: Range.prototype.getClientRects,
  rangeBox: Range.prototype.getBoundingClientRect,
  element: Element.prototype.getClientRects,
};
beforeAll(() => {
  Range.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
  Element.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList;
});
afterAll(() => {
  Range.prototype.getClientRects = original.range;
  Range.prototype.getBoundingClientRect = original.rangeBox;
  Element.prototype.getClientRects = original.element;
});

async function mount(value: RichDocContent, props: Partial<RichTextEditorProps> = {}): Promise<Editor> {
  render(
    <RichTextEditor
      value={value}
      onChange={() => {}}
      onCreate={(created) => {
        editor = created;
      }}
      {...props}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return editor as Editor;
}

const doc = (...content: JSONContent[]): RichDocContent => ({ type: 'doc', content });
const embedNode = (attrs: Record<string, unknown>): JSONContent => ({ type: 'embed', attrs });

/** pasteText は文字だけの貼り付けを起こす（jsdom には ClipboardEvent が無いので、読み口だけの偽物を渡す）。 */
function pasteText(e: Editor, text: string) {
  const event = {
    clipboardData: { getData: (type: string) => (type === 'text/plain' ? text : ''), files: [] },
    preventDefault: () => {},
  } as unknown as ClipboardEvent;
  act(() => {
    e.view.pasteText(text, event);
  });
}

function types(e: Editor): string[] {
  return (e.getJSON().content ?? []).map((n) => n.type ?? '');
}

describe('URL の貼り付け', () => {
  it('空の行に YouTube の URL だけを貼ると埋め込みになる', async () => {
    const e = await mount(doc({ type: 'paragraph' }));
    act(() => {
      e.commands.focus('end');
    });
    pasteText(e, `https://youtu.be/${ID}`);
    const embed = e.getJSON().content?.find((n) => n.type === 'embed');
    expect(embed?.attrs).toMatchObject({ provider: 'youtube', videoId: ID });
  });

  it('文の途中に貼った URL は素のリンクのまま（埋め込みにしない）', async () => {
    const e = await mount(doc({ type: 'paragraph', content: [{ type: 'text', text: '動画: ' }] }));
    act(() => {
      e.commands.focus('end');
    });
    pasteText(e, `https://youtu.be/${ID}`);
    expect(types(e)).not.toContain('embed');
    expect(e.getText()).toContain(`https://youtu.be/${ID}`);
  });

  it.each([
    ['読み取れない URL', 'https://example.com/video'],
    ['URL 以外の文字も含む', `見て https://youtu.be/${ID}`],
  ])('%s は埋め込みにしない', async (_name, text) => {
    const e = await mount(doc({ type: 'paragraph' }));
    act(() => {
      e.commands.focus('end');
    });
    pasteText(e, text);
    expect(types(e)).not.toContain('embed');
  });
});

describe('埋め込みのカード', () => {
  const saved = embedNode({ provider: 'youtube', videoId: ID, title: '10 月の説明会の録画' });

  it('押すまでは iframe も画像も作らず、題名と再生ボタンだけを描く', async () => {
    await mount(doc(saved));
    expect(screen.getByText('10 月の説明会の録画')).toBeInTheDocument();
    expect(screen.getByText('押すまで YouTube には接続しません')).toBeInTheDocument();
    expect(document.querySelector('.rte-embed iframe')).toBeNull();
    expect(document.querySelector('.rte-embed img')).toBeNull();
  });

  it('押すと youtube-nocookie.com の iframe を、決めた制限つきで作る', async () => {
    const user = userEvent.setup();
    await mount(doc(saved));
    await user.click(screen.getByRole('button', { name: '10 月の説明会の録画 を再生（YouTube を読み込みます）' }));
    const iframe = document.querySelector('.rte-embed iframe') as HTMLIFrameElement;
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1`);
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
    expect(iframe.getAttribute('allow')).toBe('autoplay; encrypted-media; fullscreen; picture-in-picture');
    expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
    expect(iframe.getAttribute('loading')).toBe('lazy');
    expect(iframe.getAttribute('title')).toBe('10 月の説明会の録画');
  });

  it('閲覧モードでも同じく押すまで読み込まず、押すと再生できる', async () => {
    const user = userEvent.setup();
    await mount(doc(saved), { editable: false });
    expect(document.querySelector('.rte-embed iframe')).toBeNull();
    await user.click(screen.getByRole('button', { name: /を再生/ }));
    expect(document.querySelector('.rte-embed iframe')).not.toBeNull();
  });

  it('題名が無ければ「YouTube の動画」と出す', async () => {
    await mount(doc(embedNode({ provider: 'youtube', videoId: ID })));
    expect(screen.getByRole('button', { name: 'YouTube の動画 を再生（YouTube を読み込みます）' })).toBeEnabled();
  });
});

describe("'/' の「埋め込み」", () => {
  async function openForm(e: Editor) {
    act(() => {
      e.chain().focus().insertContent('/embed').run();
    });
    await waitFor(() => expect(document.querySelector('.rte-slash')).not.toBeNull());
    const menu = within(screen.getByRole('listbox', { name: 'ブロックの挿入' }));
    expect(menu.getByText('/embed')).toBeInTheDocument();
    fireEvent.click(menu.getByText('埋め込み'));
    return screen.findByRole('form', { name: '埋め込みの設定' });
  }

  it('読み取れない URL は閉じずに理由を出し、読み取れる URL で埋め込みを置いて閉じる', async () => {
    const user = userEvent.setup();
    const e = await mount(doc({ type: 'paragraph' }));
    const form = await openForm(e);
    const input = within(form).getByRole('textbox', { name: '埋め込む動画の URL' });

    await user.type(input, 'https://example.com/video');
    await user.click(within(form).getByRole('button', { name: '埋め込む' }));
    expect(within(form).getByRole('alert')).toHaveTextContent('YouTube の動画の URL');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    await user.clear(input);
    await user.type(input, `https://www.youtube.com/watch?v=${ID}`);
    await user.click(within(form).getByRole('button', { name: '埋め込む' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: '埋め込みの設定' })).toBeNull());
    expect(e.getJSON().content?.find((n) => n.type === 'embed')?.attrs).toMatchObject({ provider: 'youtube', videoId: ID });
    expect(e.getText()).not.toContain('/embed');
  });

  it('Esc・取りやめるで閉じ、何も置かない', async () => {
    const user = userEvent.setup();
    const e = await mount(doc({ type: 'paragraph' }));
    let form = await openForm(e);
    await user.type(within(form).getByRole('textbox', { name: '埋め込む動画の URL' }), '{Escape}');
    await waitFor(() => expect(screen.queryByRole('form', { name: '埋め込みの設定' })).toBeNull());
    form = await openForm(e);
    await user.click(within(form).getByRole('button', { name: '取りやめる' }));
    await waitFor(() => expect(screen.queryByRole('form', { name: '埋め込みの設定' })).toBeNull());
    expect(types(e)).not.toContain('embed');
  });
});
