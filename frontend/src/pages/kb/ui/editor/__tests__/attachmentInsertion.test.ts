import { describe, it, expect, afterEach, vi } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/core';
import { Slice } from '@tiptap/pm/model';
import { createEditorExtensions } from '../editorExtensions';
import {
  attachmentInsertPos,
  attachmentUploadPluginKey,
  classifyFiles,
  clearAttachmentUploads,
  insertUploadedAttachments,
  removeForeignAttachments,
  type UploadedAttachment,
} from '../attachmentInsertion';
import { MAX_ATTACHMENT_UPLOAD_BYTES } from '@/shared/config/attachmentUpload';
import { MAX_IMAGE_UPLOAD_BYTES } from '@/shared/config/imageUpload';

const PAGE = '0198a000-0000-7000-8000-000000000003';
const OTHER_PAGE = '0198a000-0000-7000-8000-000000000009';
const ID1 = '0198a000-0000-7000-8000-0000000000c1';
const ID2 = '0198a000-0000-7000-8000-0000000000c2';

/** 大きさだけを持つ File（中身は確かめないので、size を上書きして上限の境界を作る）。 */
function fileOf(name: string, type: string, size = 10): File {
  const file = new File(['x'], name, { type });
  Object.defineProperty(file, 'size', { value: size });
  return file;
}

let editor: Editor | null = null;

function makeEditor(content: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }): Editor {
  editor = new Editor({ element: document.createElement('div'), extensions: createEditorExtensions(), content });
  return editor;
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

function attachments(doc: JSONContent): JSONContent[] {
  const out: JSONContent[] = [];
  const walk = (node: JSONContent) => {
    if (node.type === 'attachment') out.push(node);
    node.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

const uploaded = (id: string, filename: string): UploadedAttachment => ({
  id,
  pageId: PAGE,
  filename,
  contentType: 'application/pdf',
  sizeBytes: 2048,
});

describe('classifyFiles', () => {
  const both = { imageUpload: true, attachmentUpload: true };

  it('画像は画像に、許可した種類は添付に、それ以外は理由を添えて断る', () => {
    const png = fileOf('a.png', 'image/png');
    const pdf = fileOf('b.pdf', 'application/pdf');
    const html = fileOf('c.html', 'text/html');
    const svg = fileOf('d.svg', 'image/svg+xml');
    const result = classifyFiles([png, pdf, html, svg], both);
    expect(result.images).toEqual([png]);
    expect(result.attachments).toEqual([pdf]);
    expect(result.rejected.map((r) => r.file)).toEqual([html, svg]);
    expect(result.rejected[0].reason).toContain('「c.html」');
  });

  it('画像は画像の上限、添付は添付の上限で断る（上限ちょうどは通す）', () => {
    const imageAtLimit = fileOf('a.png', 'image/png', MAX_IMAGE_UPLOAD_BYTES);
    const imageOver = fileOf('b.png', 'image/png', MAX_IMAGE_UPLOAD_BYTES + 1);
    const pdfAtLimit = fileOf('c.pdf', 'application/pdf', MAX_ATTACHMENT_UPLOAD_BYTES);
    const pdfOver = fileOf('d.pdf', 'application/pdf', MAX_ATTACHMENT_UPLOAD_BYTES + 1);
    const empty = fileOf('e.pdf', 'application/pdf', 0);
    const result = classifyFiles([imageAtLimit, imageOver, pdfAtLimit, pdfOver, empty], both);
    expect(result.images).toEqual([imageAtLimit]);
    expect(result.attachments).toEqual([pdfAtLimit]);
    expect(result.rejected.map((r) => r.file.name)).toEqual(['b.png', 'd.pdf', 'e.pdf']);
    expect(result.rejected[0].reason).toContain('上限');
    expect(result.rejected[2].reason).toContain('空');
  });

  it('送り先が無い側のファイルは断る', () => {
    const png = fileOf('a.png', 'image/png');
    const pdf = fileOf('b.pdf', 'application/pdf');
    expect(classifyFiles([png, pdf], { imageUpload: false, attachmentUpload: true })).toMatchObject({
      images: [],
      attachments: [pdf],
    });
    expect(classifyFiles([png, pdf], { imageUpload: true, attachmentUpload: false })).toMatchObject({
      images: [png],
      attachments: [],
    });
  });

  it('null・undefined は何も無い', () => {
    expect(classifyFiles(null, both)).toEqual({ images: [], attachments: [], rejected: [] });
    expect(classifyFiles(undefined, both)).toEqual({ images: [], attachments: [], rejected: [] });
  });
});

describe('removeForeignAttachments', () => {
  const attachmentNode = (id: string, pageId: string, filename: string) => ({
    type: 'attachment',
    attrs: { attachmentId: id, pageId, filename },
  });

  function sliceOf(content: JSONContent[]): Slice {
    const e = makeEditor();
    const doc = e.schema.nodeFromJSON({ type: 'doc', content });
    return new Slice(doc.content, 0, 0);
  }

  it('このページの添付はそのまま、別のページの添付はファイル名の段落に置き換える', () => {
    const slice = sliceOf([attachmentNode(ID1, PAGE, '自分.pdf'), attachmentNode(ID2, OTHER_PAGE, '他.pdf')]);
    const { slice: cleaned, removed } = removeForeignAttachments(slice, editor!.schema, PAGE);
    expect(removed).toEqual(['他.pdf']);
    const json = cleaned.content.toJSON() as JSONContent[];
    expect(json[0]).toMatchObject({ type: 'attachment', attrs: { attachmentId: ID1 } });
    expect(json[1]).toMatchObject({ type: 'paragraph', content: [{ type: 'text', text: '他.pdf' }] });
  });

  it('容器の中の添付も置き換える（容器の形は崩さない）', () => {
    const slice = sliceOf([{ type: 'callout', attrs: { kind: 'info' }, content: [attachmentNode(ID2, OTHER_PAGE, '他.pdf')] }]);
    const { slice: cleaned, removed } = removeForeignAttachments(slice, editor!.schema, PAGE);
    expect(removed).toEqual(['他.pdf']);
    expect(cleaned.content.toJSON()).toMatchObject([
      { type: 'callout', content: [{ type: 'paragraph', content: [{ type: 'text', text: '他.pdf' }] }] },
    ]);
  });

  it('今のページが分からなければ添付はすべて置き換える', () => {
    const slice = sliceOf([attachmentNode(ID1, PAGE, '自分.pdf')]);
    expect(removeForeignAttachments(slice, editor!.schema, null).removed).toEqual(['自分.pdf']);
  });

  it('添付が無ければ同じ断片を返す', () => {
    const slice = sliceOf([{ type: 'paragraph', content: [{ type: 'text', text: '本文' }] }]);
    const result = removeForeignAttachments(slice, editor!.schema, PAGE);
    expect(result.slice).toBe(slice);
    expect(result.removed).toEqual([]);
  });
});

describe('insertUploadedAttachments', () => {
  it('送っている間は仮の表示だけを出し（本文には書かない）、送り終えたら添付を置く', async () => {
    const e = makeEditor();
    let resolveUpload: (value: UploadedAttachment) => void = () => {};
    const upload = vi.fn(() => new Promise<UploadedAttachment>((resolve) => (resolveUpload = resolve)));
    const done = insertUploadedAttachments(e, [fileOf('議事録.pdf', 'application/pdf')], upload, vi.fn());

    expect(upload).toHaveBeenCalledTimes(1);
    expect(attachments(e.getJSON())).toEqual([]);
    expect(e.view.dom.querySelector('.rte-attachment-uploading')?.textContent).toBe('「議事録.pdf」を送信中…');

    resolveUpload(uploaded(ID1, '議事録.pdf'));
    await done;

    expect(e.view.dom.querySelector('.rte-attachment-uploading')).toBeNull();
    expect(attachments(e.getJSON())).toMatchObject([
      { attrs: { attachmentId: ID1, pageId: PAGE, filename: '議事録.pdf', contentType: 'application/pdf', size: 2048 } },
    ]);
  });

  it('選んだ順に 1 つずつ送って置く', async () => {
    const e = makeEditor();
    const upload = vi.fn(async (file: File) => uploaded(file.name === '1.pdf' ? ID1 : ID2, file.name));
    await insertUploadedAttachments(e, [fileOf('1.pdf', 'application/pdf'), fileOf('2.pdf', 'application/pdf')], upload, vi.fn());
    expect(attachments(e.getJSON()).map((n) => n.attrs?.filename)).toEqual(['1.pdf', '2.pdf']);
  });

  it('最後の段落の後ろでも、選んだ順に 2 つとも置く（末尾に足される段落に id が振られても仮の表示は消えない）', async () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph', attrs: { id: ID2.replace('c2', 'e1') }, content: [{ type: 'text', text: '本文' }] }] });
    e.commands.setTextSelection(3);
    const upload = vi.fn(async (file: File) => uploaded(file.name === '1.pdf' ? ID1 : ID2, file.name));
    await insertUploadedAttachments(e, [fileOf('1.pdf', 'application/pdf'), fileOf('2.pdf', 'application/pdf')], upload, vi.fn());
    const blocks = e.getJSON().content ?? [];
    expect(blocks.map((n) => n.type)).toEqual(['paragraph', 'attachment', 'attachment', 'paragraph']);
    expect(attachments(e.getJSON()).map((n) => n.attrs?.filename)).toEqual(['1.pdf', '2.pdf']);
  });

  it('送れなかったら仮の表示を消し、理由を知らせ、何も置かない', async () => {
    const e = makeEditor();
    const onError = vi.fn();
    await insertUploadedAttachments(e, [fileOf('a.pdf', 'application/pdf')], vi.fn().mockRejectedValue(new Error('x')), onError);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('「a.pdf」を添付できませんでした'));
    expect(e.view.dom.querySelector('.rte-attachment-uploading')).toBeNull();
    expect(attachments(e.getJSON())).toEqual([]);
  });

  it('送っている間にページを離れたら置かない', async () => {
    const e = makeEditor();
    let alive = true;
    const upload = vi.fn(async () => {
      alive = false;
      return uploaded(ID1, 'a.pdf');
    });
    await insertUploadedAttachments(e, [fileOf('a.pdf', 'application/pdf')], upload, vi.fn(), () => alive);
    expect(attachments(e.getJSON())).toEqual([]);
  });

  it('仮の表示は前に打った文字の分だけずれて付いていき、そこに置く', async () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前' }] }] });
    e.commands.setTextSelection(2); // 「前」の後ろ
    let resolveUpload: (value: UploadedAttachment) => void = () => {};
    const done = insertUploadedAttachments(
      e,
      [fileOf('a.pdf', 'application/pdf')],
      () => new Promise((resolve) => (resolveUpload = resolve)),
      vi.fn(),
    );
    e.view.dispatch(e.state.tr.insertText('先頭', 1)); // 仮の表示より前に打つ
    resolveUpload(uploaded(ID1, 'a.pdf'));
    await done;
    const blocks = e.getJSON().content ?? [];
    expect(blocks[0]).toMatchObject({ type: 'paragraph', content: [{ type: 'text', text: '先頭前' }] });
    expect(blocks[1]).toMatchObject({ type: 'attachment', attrs: { attachmentId: ID1 } });
  });

  it('送っている間に本文が外から差し替わったら（clearAttachmentUploads）置かず、そのことを知らせる', async () => {
    const e = makeEditor({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '前の本文' }] }] });
    e.commands.setTextSelection(2);
    const onError = vi.fn();
    let resolveUpload: (value: UploadedAttachment) => void = () => {};
    const done = insertUploadedAttachments(
      e,
      [fileOf('a.pdf', 'application/pdf')],
      () => new Promise((resolve) => (resolveUpload = resolve)),
      onError,
    );
    expect(placeholderCount(e)).toBe(1);
    e.commands.setContent({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '戻した版' }] }] });
    clearAttachmentUploads(e);
    expect(placeholderCount(e)).toBe(0);
    resolveUpload(uploaded(ID1, 'a.pdf'));
    await done;
    expect(attachments(e.getJSON())).toEqual([]);
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('本文が差し替わった'));
  });

  it('空の段落へ画像を入れるような置き換えでは、待っている仮の表示は消えない', async () => {
    const e = makeEditor();
    let resolveUpload: (value: UploadedAttachment) => void = () => {};
    const done = insertUploadedAttachments(
      e,
      [fileOf('a.pdf', 'application/pdf')],
      () => new Promise((resolve) => (resolveUpload = resolve)),
      vi.fn(),
    );
    e.chain().setTextSelection(1).setImage({ src: 'kb/w/p/1.bin' }).run();
    expect(placeholderCount(e)).toBe(1);
    resolveUpload(uploaded(ID1, 'a.pdf'));
    await done;
    expect(attachments(e.getJSON())).toHaveLength(1);
  });
});

describe('attachmentInsertPos', () => {
  it('中身の無い段落ならその直前、文のある段落ならその直後', () => {
    const e = makeEditor({
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '文' }] }, { type: 'paragraph' }],
    });
    e.commands.setTextSelection(1);
    expect(attachmentInsertPos(e.state)).toBe(3);
    e.commands.setTextSelection(4);
    expect(attachmentInsertPos(e.state)).toBe(3);
  });

  it('折りたたみの見出しの中では、折りたたみの外（直後）にする', () => {
    const e = makeEditor({
      type: 'doc',
      content: [
        {
          type: 'details',
          content: [
            { type: 'detailsSummary', content: [{ type: 'text', text: '見出し' }] },
            { type: 'detailsContent', content: [{ type: 'paragraph' }] },
          ],
        },
      ],
    });
    e.commands.setTextSelection(3);
    const pos = attachmentInsertPos(e.state);
    expect(pos).toBe(e.state.doc.child(0).nodeSize);
  });
});

function placeholderCount(e: Editor): number {
  return (attachmentUploadPluginKey.getState(e.state) ?? []).length;
}
