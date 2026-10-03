import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Editor, JSONContent } from '@tiptap/react';
import { Slice } from '@tiptap/pm/model';
import type { EditorView } from '@tiptap/pm/view';
import RichTextEditor, { type RichTextEditorProps } from '../RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';
import type { UploadedAttachment } from '../attachmentInsertion';

const PAGE = '0198a000-0000-7000-8000-000000000003';
const OTHER_PAGE = '0198a000-0000-7000-8000-000000000009';
const ID1 = '0198a000-0000-7000-8000-0000000000c1';
const ID2 = '0198a000-0000-7000-8000-0000000000c2';

let editor: Editor | null = null;

afterEach(() => {
  cleanup();
  editor = null;
  vi.restoreAllMocks();
});

async function mount(value: RichDocContent, props: Partial<RichTextEditorProps> = {}): Promise<Editor> {
  render(
    <RichTextEditor
      value={value}
      onChange={() => {}}
      attachmentPageId={PAGE}
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
const attachmentNode = (attrs: Record<string, unknown>): JSONContent => ({ type: 'attachment', attrs });

function fileOf(name: string, type: string): File {
  return new File(['x'], name, { type });
}

/**
 * dropFiles はエディタの handleDrop をファイル付きの偽のイベントで呼ぶ（jsdom には DataTransfer が
 * 無い。本物のドロップは Storybook の見本で確かめる）。
 */
function dropFiles(e: Editor, files: File[]): boolean {
  const event = { dataTransfer: { files }, preventDefault: vi.fn() } as unknown as DragEvent;
  let handled = false;
  act(() => {
    handled = Boolean(
      e.view.someProp('handleDrop', (f: (view: EditorView, event: DragEvent, slice: Slice, moved: boolean) => boolean) =>
        f(e.view, event, Slice.empty, false),
      ),
    );
  });
  return handled;
}

const uploaded = (id: string, filename: string): UploadedAttachment => ({
  id,
  pageId: PAGE,
  filename,
  contentType: 'application/pdf',
  sizeBytes: 2048,
});

describe('添付のドロップ', () => {
  it('画像は画像の口へ、許可した種類は添付の口へ送り、許可しない種類は理由を知らせる', async () => {
    const onImageUpload = vi.fn(async () => 'kb/w/p/1.bin');
    const onAttachmentUpload = vi.fn(async (file: File) => uploaded(ID1, file.name));
    const onNotice = vi.fn();
    const e = await mount(doc({ type: 'paragraph' }), { onImageUpload, onAttachmentUpload, onNotice });

    const png = fileOf('写真.png', 'image/png');
    const pdf = fileOf('議事録.pdf', 'application/pdf');
    const html = fileOf('罠.html', 'text/html');
    expect(dropFiles(e, [png, pdf, html])).toBe(true);

    await waitFor(() => expect(e.getJSON().content?.some((n) => n.type === 'attachment')).toBe(true));
    expect(onImageUpload).toHaveBeenCalledWith(png);
    expect(onAttachmentUpload).toHaveBeenCalledWith(pdf);
    expect(onAttachmentUpload).toHaveBeenCalledTimes(1);
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('「罠.html」'));
    expect(await screen.findByText('議事録.pdf')).toBeInTheDocument();
  });

  it('送り先が無ければドロップを扱わない（ProseMirror に任せる）', async () => {
    const e = await mount(doc({ type: 'paragraph' }));
    expect(dropFiles(e, [fileOf('a.pdf', 'application/pdf')])).toBe(false);
  });

  it('送っている間に別のページへ移ったら、前のページの添付を置かない', async () => {
    let resolveUpload: (value: UploadedAttachment) => void = () => {};
    const onAttachmentUpload = vi.fn(() => new Promise<UploadedAttachment>((resolve) => (resolveUpload = resolve)));
    const props = { onAttachmentUpload, onChange: () => {} };
    const { rerender } = render(
      <RichTextEditor
        value={doc({ type: 'paragraph', content: [{ type: 'text', text: '前のページ' }] })}
        attachmentPageId={PAGE}
        onCreate={(created) => {
          editor = created;
        }}
        {...props}
      />,
    );
    await waitFor(() => expect(editor).not.toBeNull());
    const e = editor as Editor;
    dropFiles(e, [fileOf('a.pdf', 'application/pdf')]);
    rerender(
      <RichTextEditor
        value={doc({ type: 'paragraph', content: [{ type: 'text', text: '次のページ' }] })}
        attachmentPageId={OTHER_PAGE}
        {...props}
      />,
    );
    await waitFor(() => expect(e.getText()).toContain('次のページ'));
    await act(async () => {
      resolveUpload(uploaded(ID1, 'a.pdf'));
    });
    expect(e.getJSON().content?.some((n) => n.type === 'attachment')).toBe(false);
  });
});

describe("'/' の「ファイル」", () => {
  // jsdom は Range/Element の getClientRects を実装せず、メニューの位置決めで落ちる（slashCommand の
  // 結合テストと同じ手当て。位置は見ない）。
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

  async function typeSlash(e: Editor, query: string) {
    act(() => {
      e.chain().focus().insertContent(`/${query}`).run();
    });
    await waitFor(() => expect(document.querySelector('.rte-slash')).not.toBeNull());
  }

  it('添付の送り先があるときだけ出て、選ぶとファイルを選ぶ欄が開く', async () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {});
    const e = await mount(doc({ type: 'paragraph' }), { onAttachmentUpload: vi.fn() });
    await typeSlash(e, 'file');
    const menu = within(screen.getByRole('listbox', { name: 'ブロックの挿入' }));
    expect(menu.getByText('/file')).toBeInTheDocument();
    fireEvent.click(menu.getByText('ファイル'));
    await waitFor(() => expect(click).toHaveBeenCalled());
    const input = click.mock.instances[0] as unknown as HTMLInputElement;
    expect(input.accept).toContain('application/pdf');
    expect(input.multiple).toBe(true);
  });

  it('送り先が無ければ出ない', async () => {
    const e = await mount(doc({ type: 'paragraph' }), { onImageUpload: vi.fn() });
    act(() => {
      e.chain().focus().insertContent('/').run();
    });
    await waitFor(() => expect(document.querySelector('.rte-slash')).not.toBeNull());
    const menu = within(screen.getByRole('listbox', { name: 'ブロックの挿入' }));
    expect(menu.queryByText('/file')).toBeNull();
    expect(menu.getByText('/image')).toBeInTheDocument();
  });
});

describe('添付のカード', () => {
  const saved = attachmentNode({
    attachmentId: ID1,
    pageId: PAGE,
    filename: '四半期の見積.xlsx',
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    size: 1536,
  });

  it('ファイル名と大きさを出し、押すと期限付き URL を取って新しいタブで開く', async () => {
    const user = userEvent.setup();
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    const downloadAttachment = vi.fn(async () => 'https://storage.example/att?sig=1');
    await mount(doc(saved, { type: 'paragraph' }), { downloadAttachment });

    expect(screen.getByText('四半期の見積.xlsx')).toBeInTheDocument();
    expect(screen.getByText('1.5 KB')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '四半期の見積.xlsx をダウンロード' }));

    expect(downloadAttachment).toHaveBeenCalledWith(ID1);
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.example/att?sig=1', '_blank', 'noopener,noreferrer'));
  });

  it('URL を取れなければ理由を出す', async () => {
    const user = userEvent.setup();
    const downloadAttachment = vi.fn().mockRejectedValue(new Error('404'));
    await mount(doc(saved, { type: 'paragraph' }), { downloadAttachment });
    await user.click(screen.getByRole('button', { name: '四半期の見積.xlsx をダウンロード' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('取得できませんでした');
  });

  it('閲覧モードでもダウンロードできる', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'open').mockReturnValue(null);
    const downloadAttachment = vi.fn(async () => 'https://storage.example/att');
    await mount(doc(saved), { downloadAttachment, editable: false });
    await user.click(screen.getByRole('button', { name: '四半期の見積.xlsx をダウンロード' }));
    expect(downloadAttachment).toHaveBeenCalledWith(ID1);
  });

  it('ダウンロードの口が無ければ押せない', async () => {
    await mount(doc(saved));
    expect(screen.getByRole('button', { name: '四半期の見積.xlsx をダウンロード' })).toBeDisabled();
  });
});

describe('添付の貼り付け', () => {
  const html = (pageId: string, id: string, filename: string) =>
    `<div data-attachment data-attachment-id="${id}" data-page-id="${pageId}" data-filename="${filename}">${filename}</div>`;

  function paste(e: Editor, content: string) {
    act(() => {
      // jsdom には ClipboardEvent が無いので、ただのイベントを渡す（中身はファイルを持たない貼り付け）。
      e.view.pasteHTML(content, new Event('paste') as ClipboardEvent);
    });
  }

  it('同じページの添付はそのまま貼れる', async () => {
    const onNotice = vi.fn();
    const e = await mount(doc({ type: 'paragraph' }), { onNotice });
    paste(e, html(PAGE, ID1, '自分.pdf'));
    expect(e.getJSON().content?.find((n) => n.type === 'attachment')?.attrs?.attachmentId).toBe(ID1);
    expect(onNotice).not.toHaveBeenCalled();
  });

  it('別のページの添付はファイル名の段落に置き換え、知らせる', async () => {
    const onNotice = vi.fn();
    const e = await mount(doc({ type: 'paragraph' }), { onNotice });
    paste(e, html(OTHER_PAGE, ID2, '他.pdf'));
    expect(e.getJSON().content?.some((n) => n.type === 'attachment')).toBe(false);
    expect(e.getText()).toContain('他.pdf');
    expect(onNotice).toHaveBeenCalledWith(expect.stringContaining('他.pdf'));
  });
});
