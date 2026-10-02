import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, waitFor, act, fireEvent, within } from '@testing-library/react';
import type { Editor, JSONContent } from '@tiptap/react';
import RichTextEditor from '../RichTextEditor';
import { emptyRichDoc } from '@/shared/lib/richDoc';
// jsdom は Range/Element の getClientRects を実装せず、ProseMirror の scrollToSelection が
// 非同期に落ちる。位置は検証しない（メニューの出現と操作だけ見る）ため、ゼロ矩形で埋める。
const zeroRect = {
  x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
  toJSON() { return this; },
} as DOMRect;
const origRangeGetClientRects = Range.prototype.getClientRects;
const origRangeGetBoundingClientRect = Range.prototype.getBoundingClientRect;
const origElemGetClientRects = Element.prototype.getClientRects;

beforeAll(() => {
  Range.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => zeroRect;
  Element.prototype.getClientRects = () => [zeroRect] as unknown as DOMRectList;
});

afterAll(() => {
  Range.prototype.getClientRects = origRangeGetClientRects;
  Range.prototype.getBoundingClientRect = origRangeGetBoundingClientRect;
  Element.prototype.getClientRects = origElemGetClientRects;
});

/** setup はエディタを描画し、onCreate 経由で editor 実体を返す。 */
async function setup(props: Partial<Parameters<typeof RichTextEditor>[0]> = {}) {
  let editor: Editor | null = null;
  const onChange = vi.fn();
  render(
    <RichTextEditor
      value={emptyRichDoc()}
      onChange={onChange}
      onCreate={(created) => {
        editor = created;
      }}
      {...props}
    />,
  );
  await waitFor(() => expect(editor).not.toBeNull());
  return { editor: editor! as Editor, onChange };
}

/** typeSlash は '/'＋クエリをエディタへ入力してメニューを開く。 */
async function typeSlash(editor: Editor, query = '') {
  act(() => {
    editor.chain().focus().insertContent(`/${query}`).run();
  });
  await waitFor(() => expect(document.querySelector('.rte-slash')).not.toBeNull());
}

function findNode(node: JSONContent, type: string): JSONContent | undefined {
  if (node.type === type) return node;
  for (const child of node.content ?? []) {
    const found = findNode(child, type);
    if (found) return found;
  }
  return undefined;
}

describe('スラッシュコマンド（統合）', () => {
  it("'/' でブロック挿入メニューが開き、英語トリガを併記した候補が出る", async () => {
    const { editor } = await setup();
    await typeSlash(editor);
    expect(screen.getByRole('listbox', { name: 'ブロックの挿入' })).toBeInTheDocument();
    expect(screen.getByText('見出し1')).toBeInTheDocument();
    expect(screen.getByText('/heading1')).toBeInTheDocument();
  });

  it("'/h1' で絞り込まれ、Enter で見出し1に変換されトリガ文字列は残らない", async () => {
    const { editor } = await setup();
    await typeSlash(editor, 'h1');
    await waitFor(() => expect(screen.getAllByRole('option')[0]).toHaveTextContent('見出し1'));
    act(() => {
      // Suggestion の onKeyDown 経由（実際のキー操作と同じ経路）。
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    await waitFor(() => {
      const heading = findNode(editor.getJSON(), 'heading');
      expect(heading?.attrs?.level).toBe(1);
    });
    // 入力した "/h1" は削除されている。
    expect(editor.getText()).not.toContain('/h1');
  });

  it('クリックでも実行できる（引用へ変換）', async () => {
    const { editor } = await setup();
    await typeSlash(editor, 'quote');
    await waitFor(() => expect(screen.getByText('引用')).toBeInTheDocument());
    fireEvent.click(screen.getByText('引用'));
    await waitFor(() => expect(findNode(editor.getJSON(), 'blockquote')).toBeDefined());
  });

  it("extraSlashCommands で足した項目が '/' メニューに出て、実行で run が editor 付きで呼ばれる", async () => {
    const run = vi.fn();
    const { editor } = await setup({
      extraSlashCommands: [
        { id: 'page', label: 'ページ', group: 'insert', glyph: '📄', keywords: ['page'], run },
      ],
    });
    await typeSlash(editor, 'page');
    const option = await screen.findByRole('option', { name: /ページ/ });
    // 押すのは option 自身（option の中に押せるものを入れ子にしない形へ改めた）。
    fireEvent.click(option);
    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(run).toHaveBeenCalledWith(editor);
    // 入力した "/page" は本文に残らない。
    expect(editor.getText()).not.toContain('/page');
  });

  it("extraSlashCommands を渡さなければ '/page' は出ない（配線の無い操作を見せない）", async () => {
    const { editor } = await setup();
    await typeSlash(editor, 'page');
    await waitFor(() => expect(screen.getByText('該当するコマンドがありません')).toBeInTheDocument());
  });

  it('該当なしのクエリでは空表示になる', async () => {
    const { editor } = await setup();
    await typeSlash(editor, 'zzz');
    await waitFor(() => expect(screen.getByText('該当するコマンドがありません')).toBeInTheDocument());
  });

  it('onImageUpload 指定時のみ /image が出て、確定→ファイル選択→アップロード→画像挿入まで通る', async () => {
    const upload = vi.fn().mockResolvedValue('https://cdn.example.com/a.png');
    const { editor } = await setup({ onImageUpload: upload });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    const clickSpy = vi.spyOn(input, 'click').mockImplementation(() => {});

    await typeSlash(editor, 'image');
    await waitFor(() => expect(screen.getByText('画像')).toBeInTheDocument());
    fireEvent.click(screen.getByText('画像'));
    expect(clickSpy).toHaveBeenCalled();

    // ファイル選択後、アップロード → 返却 URL の image ノード挿入まで到達すること。
    const file = new File(['image'], 'a.png', { type: 'image/png' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(upload).toHaveBeenCalledWith(file));
    await waitFor(() => {
      expect(findNode(editor.getJSON(), 'image')?.attrs?.src).toBe('https://cdn.example.com/a.png');
    });
  });

  it('メニュー表示中は textbox に aria 属性が付き、矢印キーで aria-activedescendant が追従する', async () => {
    const { editor } = await setup();
    const textbox = editor.view.dom;
    expect(textbox.getAttribute('aria-controls')).toBeNull();

    await typeSlash(editor);
    const listboxId = textbox.getAttribute('aria-controls');
    // aria-expanded は textbox には付けられない（axe の aria-allowed-attr）ので、つながりは aria-controls で見る。
    expect(textbox.getAttribute('aria-expanded')).toBeNull();
    expect(listboxId).toBeTruthy();
    expect(document.getElementById(listboxId!)).toHaveAttribute('role', 'listbox');
    // 初期状態は先頭 option を指す。
    await waitFor(() =>
      expect(textbox.getAttribute('aria-activedescendant')).toBe(`${listboxId}-option-heading1`),
    );

    act(() => {
      textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    });
    await waitFor(() =>
      expect(textbox.getAttribute('aria-activedescendant')).toBe(`${listboxId}-option-heading2`),
    );

    // Escape で閉じると aria 属性も外れる。
    act(() => {
      textbox.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => expect(textbox.getAttribute('aria-expanded')).toBeNull());
    expect(textbox.getAttribute('aria-controls')).toBeNull();
    expect(textbox.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('onImageUpload なしでは /image を出さない', async () => {
    const { editor } = await setup();
    await typeSlash(editor, 'image');
    await waitFor(() => expect(screen.getByText('該当するコマンドがありません')).toBeInTheDocument());
  });

  it('Escape でメニューが閉じる', async () => {
    const { editor } = await setup();
    await typeSlash(editor);
    act(() => {
      editor.view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    await waitFor(() => expect(document.querySelector('.rte-slash')).toBeNull());
  });
});
