import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, fireEvent, act, within } from '@testing-library/react';
import RichTextEditor from '../RichTextEditor';
import { emptyRichDoc, type RichDocContent } from '@/shared/lib/richDoc';
/**
 * ImageView（画像ノードの NodeView）は単体で置けない部品なので、CodeBlockView と同じく
 * RichTextEditor へ画像を含む doc を読ませて描画を見る。
 */
const docWithImage = (src: string, alt = '写真'): RichDocContent => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '本文' }] },
    { type: 'image', attrs: { src, alt } },
  ],
});

/**
 * アクセシブルな role + name（alt）で取得する（querySelector('img') は role・name を
 * 検証しないので alt の回帰を見逃す — CodeRabbit 指摘）。読み込み中/失敗のプレースホルダも
 * role="img" だが aria-label が別文言（例: "写真（読み込み中）"）なので、name の完全一致で
 * 実際の <img alt> とは区別できる。
 */
async function findImg(container: HTMLElement, name = '写真') {
  return (await within(container).findByRole('img', { name })) as HTMLImageElement;
}

describe('ImageView', () => {
  it('"kb/" で始まる src は resolveImageSrc に投げ、解決中はプレースホルダを出す', async () => {
    // 解決のタイミングを自分で握るため、実装が内部でいつ微小タスクを消化していても
    // 「解決前はプレースホルダ・解決後は img」の 2 状態を確実に見分けられるようにする。
    let resolve: (url: string) => void = () => {};
    const resolveImageSrc = vi.fn(
      () =>
        new Promise<string>((res) => {
          resolve = res;
        }),
    );
    const { container } = render(
      <RichTextEditor value={docWithImage('kb/w-1/p-1/1.bin')} resolveImageSrc={resolveImageSrc} />,
    );

    await waitFor(() => expect(resolveImageSrc).toHaveBeenCalledWith('kb/w-1/p-1/1.bin'));
    expect(resolveImageSrc).toHaveBeenCalledTimes(1);
    // まだ解決していないので読み込み中のプレースホルダのまま。
    expect(container.querySelector('[data-state="loading"]')).not.toBeNull();
    expect(container.querySelector('img')).toBeNull();

    await act(async () => {
      resolve('https://s3.example.com/signed?sig=1');
    });

    const img = await findImg(container);
    expect(img).toHaveAttribute('src', 'https://s3.example.com/signed?sig=1');
    expect(img).toHaveAttribute('alt', '写真');
    // doc の src 自体は書き換えない（key のまま）— NodeView の描画結果だけを見ている。
    expect(container.querySelector('[data-state="loading"]')).toBeNull();
  });

  it('http(s):// の src は resolveImageSrc を呼ばずそのまま使う（既存互換）', async () => {
    const resolveImageSrc = vi.fn();
    const { container } = render(
      <RichTextEditor
        value={docWithImage('https://cdn.example.com/a.png')}
        resolveImageSrc={resolveImageSrc}
      />,
    );

    const img = await findImg(container);
    expect(img).toHaveAttribute('src', 'https://cdn.example.com/a.png');
    expect(resolveImageSrc).not.toHaveBeenCalled();
  });

  it('data: の src も resolveImageSrc を呼ばずそのまま使う', async () => {
    const resolveImageSrc = vi.fn();
    const src = 'data:image/png;base64,iVBORw0KGgo=';
    const { container } = render(
      <RichTextEditor value={docWithImage(src)} resolveImageSrc={resolveImageSrc} />,
    );

    const img = await findImg(container);
    expect(img).toHaveAttribute('src', src);
    expect(resolveImageSrc).not.toHaveBeenCalled();
  });

  it('resolveImageSrc が渡されなければ "kb/" の src も解決せずそのまま使う（story・他画面との後方互換）', async () => {
    const { container } = render(<RichTextEditor value={docWithImage('kb/w-1/p-1/1.bin')} />);

    const img = await findImg(container);
    expect(img).toHaveAttribute('src', 'kb/w-1/p-1/1.bin');
  });

  it('onError で 1 回だけ再解決する（期限切れ対策・無限ループ防止）', async () => {
    const resolveImageSrc = vi
      .fn()
      .mockResolvedValueOnce('https://s3.example.com/signed?sig=1')
      .mockResolvedValueOnce('https://s3.example.com/signed?sig=2');
    const { container } = render(
      <RichTextEditor value={docWithImage('kb/w-1/p-1/1.bin')} resolveImageSrc={resolveImageSrc} />,
    );

    const img = await findImg(container);
    expect(img).toHaveAttribute('src', 'https://s3.example.com/signed?sig=1');

    // 1 回目のエラー: 再解決して新しい URL に差し替わる。
    fireEvent.error(img);
    await waitFor(() => expect(resolveImageSrc).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(img).toHaveAttribute('src', 'https://s3.example.com/signed?sig=2'),
    );

    // 2 回目のエラー: もう再解決しない（無限ループ防止）。失敗表示になる。
    fireEvent.error(img);
    await waitFor(() =>
      expect(container.querySelector('[data-state="failed"]')).not.toBeNull(),
    );
    expect(resolveImageSrc).toHaveBeenCalledTimes(2);
  });

  it('解決そのものに失敗したら失敗表示になる', async () => {
    const resolveImageSrc = vi.fn().mockRejectedValue(new Error('404'));
    const { container } = render(
      <RichTextEditor
        value={docWithImage('kb/w-1/p-1/missing.bin')}
        resolveImageSrc={resolveImageSrc}
      />,
    );

    await waitFor(() =>
      expect(container.querySelector('[data-state="failed"]')).not.toBeNull(),
    );
  });

  it('src が別の画像に変わったら改めて解決する（NodeViewは使い回されるため）', async () => {
    // Tiptap の ReactNodeViewRenderer は同じ位置・同じ型のノードなら NodeView の
    // React コンポーネントを再マウントせず、新しい node だけを渡す。value の外部差し替え
    // （setContent）でも同じことが起きるため、古い画像の解決結果が新しい画像に
    // 残らないことをここで固定する。
    const resolveImageSrc = vi
      .fn()
      .mockResolvedValueOnce('https://s3.example.com/a-resolved')
      .mockResolvedValueOnce('https://s3.example.com/b-resolved');
    const { container, rerender } = render(
      <RichTextEditor value={docWithImage('kb/w-1/p-1/a.bin', '画像A')} resolveImageSrc={resolveImageSrc} />,
    );

    const imgA = await findImg(container, '画像A');
    expect(imgA).toHaveAttribute('src', 'https://s3.example.com/a-resolved');
    expect(resolveImageSrc).toHaveBeenCalledWith('kb/w-1/p-1/a.bin');

    rerender(
      <RichTextEditor value={docWithImage('kb/w-1/p-1/b.bin', '画像A')} resolveImageSrc={resolveImageSrc} />,
    );

    await waitFor(() => expect(resolveImageSrc).toHaveBeenCalledWith('kb/w-1/p-1/b.bin'));
    const imgB = await findImg(container, '画像A');
    await waitFor(() => expect(imgB).toHaveAttribute('src', 'https://s3.example.com/b-resolved'));
  });

  // RichTextEditor の value prop は sanitizeDocLinks（linkSafety.ts）を経由するため、
  // docWithImage で不正な src を渡しても、ImageView へ届く前に木から落ちてしまい
  // ImageView 自身の検査は試せない。ImageView.tsx 自体が持つ保険（描画直前の再検査）は、
  // value の差し替えを経由しない経路（editor.commands 経由の直接操作）で確かめる。
  it('editor.commands で不正な src の画像を直接差し込んでも <img> にしない（NodeView 自身の保険）', async () => {
    let editor: import('@tiptap/react').Editor | null = null;
    const { container } = render(
      <RichTextEditor
        value={emptyRichDoc()}
        onCreate={(created) => {
          editor = created;
        }}
      />,
    );
    await waitFor(() => expect(editor).not.toBeNull());

    act(() => {
      editor!.chain().focus().setImage({ src: 'javascript:alert(1)', alt: '危険' }).run();
    });

    await waitFor(() => expect(container.querySelector('[data-state="failed"]')).not.toBeNull());
    expect(container.querySelector('img')).toBeNull();
  });
});
