import { describe, it, expect, afterEach } from 'vitest';
import { Editor, type JSONContent } from '@tiptap/react';
import { createEditorExtensions } from '../editorExtensions';
import { emptyRichDoc } from '@/shared/lib/richDoc';
import { acceptedImageFiles, insertUploadedImages } from '../imageInsertion';

let editor: Editor | null = null;

function makeEditor(): Editor {
  editor = new Editor({
    element: document.createElement('div'),
    extensions: createEditorExtensions(),
    content: emptyRichDoc(),
  });
  return editor;
}

/** collectImages は doc ツリー内の image ノードを深さ優先で集める（挿入順の検証用）。 */
function collectImages(node: JSONContent, acc: JSONContent[] = []): JSONContent[] {
  if (node.type === 'image') acc.push(node);
  node.content?.forEach((child) => collectImages(child, acc));
  return acc;
}

const imageFile = (name: string) => new File(['x'], name, { type: 'image/png' });

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe('acceptedImageFiles', () => {
  it('画像 MIME のファイルだけを取り出す', () => {
    const files = [
      imageFile('a.png'),
      new File(['x'], 'b.txt', { type: 'text/plain' }),
      new File(['x'], 'c.webp', { type: 'image/webp' }),
    ];
    expect(acceptedImageFiles(files).map((f) => f.name)).toEqual(['a.png', 'c.webp']);
  });

  it('null / undefined は空配列', () => {
    expect(acceptedImageFiles(null)).toEqual([]);
    expect(acceptedImageFiles(undefined)).toEqual([]);
  });
});

describe('insertUploadedImages', () => {
  it('返却 URL とファイル名を src / alt に持つ image を挿入する', async () => {
    const e = makeEditor();
    await insertUploadedImages(e, [imageFile('a.png')], async () => 'https://cdn.example.com/a.png');
    const images = collectImages(e.getJSON());
    expect(images).toHaveLength(1);
    expect(images[0].attrs?.src).toBe('https://cdn.example.com/a.png');
    expect(images[0].attrs?.alt).toBe('a.png');
  });

  it('複数画像を順次アップロードする（前の完了後に次を開始し、順序を保つ）', async () => {
    const e = makeEditor();
    const started: string[] = [];
    const finished: string[] = [];
    // 先頭 a.png を遅くする。順次なら a 完了後に b 開始 → 完了順は入力順。
    // 並列だと速い b.png が先に完了してしまう（この差で順次性を検証する）。
    const upload = (file: File) => {
      started.push(file.name);
      return new Promise<string>((resolve) => {
        setTimeout(
          () => {
            finished.push(file.name);
            resolve(`https://cdn.example.com/${file.name}`);
          },
          file.name === 'a.png' ? 20 : 1,
        );
      });
    };
    await insertUploadedImages(e, [imageFile('a.png'), imageFile('b.png')], upload);
    expect(started).toEqual(['a.png', 'b.png']);
    expect(finished).toEqual(['a.png', 'b.png']);
    // 挿入自体が行われること（headless では focus 復元が無く複数挿入の位置検証はしない）。
    expect(collectImages(e.getJSON()).length).toBeGreaterThanOrEqual(1);
  });

  it('isAlive が false なら挿入しない（別文書への誤挿入防止）', async () => {
    const e = makeEditor();
    await insertUploadedImages(
      e,
      [imageFile('a.png')],
      async () => 'https://cdn.example.com/a.png',
      () => false,
    );
    expect(collectImages(e.getJSON())).toHaveLength(0);
  });

  it('editor が破棄済みなら挿入しない', async () => {
    const e = makeEditor();
    let uploaded = false;
    const upload = async () => {
      e.destroy();
      uploaded = true;
      return 'https://cdn.example.com/a.png';
    };
    await insertUploadedImages(e, [imageFile('a.png')], upload);
    expect(uploaded).toBe(true);
    // 破棄後は getJSON を呼べないので、例外なく完了したこと（挿入に進まなかったこと）を確認する。
    expect(e.isDestroyed).toBe(true);
    editor = null; // afterEach の二重 destroy を避ける
  });

  it('アップロード失敗は握りつぶし、次の画像は挿入する', async () => {
    const e = makeEditor();
    const upload = async (file: File) => {
      if (file.name === 'bad.png') throw new Error('upload failed');
      return `https://cdn.example.com/${file.name}`;
    };
    await insertUploadedImages(e, [imageFile('bad.png'), imageFile('ok.png')], upload);
    const srcs = collectImages(e.getJSON()).map((img) => img.attrs?.src);
    expect(srcs).toEqual(['https://cdn.example.com/ok.png']);
  });

  // uploader 自体はこの画面のコードで信頼できる url を返す前提だが、doc へ書き込む直前の
  // 検査を linkSafety.ts の許可リストへ揃えておく（uploader の実装が将来変わっても
  // doc 側の不変条件が保たれるようにするための保険）。1 ファイルだけで確かめる
  // （2 ファイル目以降は headless では焦点復元が無く挿入位置が安定しない — 上のテストの
  // コメント参照。ここでは「挿入しない」ことだけを純粋に見たいので confound を避ける）。
  it('uploader が許可リストに無い url を返したら挿入しない', async () => {
    const e = makeEditor();
    await insertUploadedImages(e, [imageFile('bad.png')], async () => 'javascript:alert(1)');
    expect(collectImages(e.getJSON())).toHaveLength(0);
  });
});
