import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, spyOn, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor, { type RichTextEditorProps } from './RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';
import type { UploadedAttachment } from './attachmentInsertion';

/**
 * 添付（第 6 段）。画像以外のファイルを本文に置き、押すと元の名前で保存する。
 *
 * - ドロップ・貼り付け・'/' の「ファイル」で置く。画像は今までどおり画像に、許可した種類は添付に、
 *   それ以外（html・svg・実行形式）と上限を超えるものは送る前に理由を出して断る
 * - 送っている間は置く場所に「送信中」の仮の表示を出す（本文には書かない）。失敗したら消して理由を出す
 * - 別のページの添付は貼り付けられない（ファイル名だけの段落にして知らせる）
 * - カードは種類の印・ファイル名・大きさ・「ダウンロード」。閲覧モードでも押せる
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/Attachments',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const PAGE = '0198a000-0000-7000-8000-000000000003';
const OTHER_PAGE = '0198a000-0000-7000-8000-000000000009';
const ID1 = '0198a000-0000-7000-8000-0000000000c1';
const ID2 = '0198a000-0000-7000-8000-0000000000c2';
const ID3 = '0198a000-0000-7000-8000-0000000000c3';

function Harness({ initial, ...props }: { initial: RichDocContent } & Partial<RichTextEditorProps>) {
  const [value, setValue] = useState<RichDocContent>(initial);
  return (
    <div style={{ width: 742 }}>
      <RichTextEditor value={value} onChange={setValue} ariaLabel="本文" attachmentPageId={PAGE} {...props} />
    </div>
  );
}

const savedDoc: RichDocContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '10 月の定例の資料です。' }] },
    {
      type: 'attachment',
      attrs: { attachmentId: ID1, pageId: PAGE, filename: '議事録 2026-10.pdf', contentType: 'application/pdf', size: 482_133 },
    },
    {
      type: 'attachment',
      attrs: {
        attachmentId: ID2,
        pageId: PAGE,
        filename: '四半期の見積と前年同期の比較（営業部・開発部・管理部・人事部・総務部・法務部をまとめた最終版・差し替え後の確定稿）.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        size: 3_250_000,
      },
    },
    {
      type: 'attachment',
      attrs: { attachmentId: ID3, pageId: PAGE, filename: '会場の写真.png', contentType: 'image/png', size: 820 },
    },
    { type: 'paragraph' },
  ],
};

const emptyDoc: RichDocContent = { type: 'doc', content: [{ type: 'paragraph' }] };

const uploaded = (file: File, id = ID1): UploadedAttachment => ({
  id,
  pageId: PAGE,
  filename: file.name,
  contentType: file.type,
  sizeBytes: file.size,
});

/** 本文の器へファイルを落とす（本物の DataTransfer を使う）。 */
function dropFiles(canvasElement: HTMLElement, files: File[]) {
  const target = canvasElement.querySelector('.ProseMirror') as HTMLElement;
  const rect = target.getBoundingClientRect();
  const dataTransfer = new DataTransfer();
  for (const file of files) dataTransfer.items.add(file);
  target.dispatchEvent(
    new DragEvent('drop', {
      dataTransfer,
      bubbles: true,
      cancelable: true,
      clientX: rect.left + 10,
      clientY: rect.top + 10,
    }),
  );
}

/** 置いた添付のカード。種類の印・名前・大きさ・ダウンロード。長い名前は 1 行で切る。 */
export const 表示: Story = {
  render: () => <Harness initial={savedDoc} downloadAttachment={async () => 'about:blank'} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('議事録 2026-10.pdf')).toBeVisible();
    await expect(canvas.getByText('470.8 KB')).toBeVisible();
    await expect(canvas.getByText('3.1 MB')).toBeVisible();
    await expect(canvas.getByText('820 B')).toBeVisible();
    const long = canvasElement.querySelectorAll('.rte-attachment-name')[1] as HTMLElement;
    await expect(long.scrollWidth).toBeGreaterThan(long.clientWidth);
  },
};

/** 押すと期限付き URL を取り、新しいタブで開く（URL は元の名前で保存させる指定つき）。 */
export const ダウンロード: Story = {
  render: (args) => <Harness initial={savedDoc} downloadAttachment={args.downloadAttachment} />,
  args: { downloadAttachment: fn(async () => 'https://storage.example/att?sig=1') },
  play: async ({ canvasElement, args }) => {
    const open = spyOn(window, 'open').mockReturnValue(null);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '議事録 2026-10.pdf をダウンロード' }));
    await expect(args.downloadAttachment).toHaveBeenCalledWith(ID1);
    await waitFor(() => expect(open).toHaveBeenCalledWith('https://storage.example/att?sig=1', '_blank', 'noopener,noreferrer'));
    open.mockRestore();
  },
};

/** URL を取れなかったら、カードの中に理由を出す。 */
export const ダウンロードに失敗: Story = {
  render: () => (
    <Harness
      initial={savedDoc}
      downloadAttachment={async () => {
        throw new Error('404');
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '議事録 2026-10.pdf をダウンロード' }));
    await expect(await canvas.findByRole('alert')).toHaveTextContent('取得できませんでした');
  },
};

/** 閲覧モードでも同じカードで、ダウンロードできる。 */
export const 閲覧モード: Story = {
  render: (args) => <Harness initial={savedDoc} editable={false} downloadAttachment={args.downloadAttachment} />,
  args: { downloadAttachment: fn(async () => 'https://storage.example/att') },
  play: async ({ canvasElement, args }) => {
    const open = spyOn(window, 'open').mockReturnValue(null);
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '会場の写真.png をダウンロード' }));
    await expect(args.downloadAttachment).toHaveBeenCalledWith(ID3);
    open.mockRestore();
  },
};

/** 送っている間は、置く場所に「送信中」の仮の表示を出す（本文には書かない）。 */
export const 送信中: Story = {
  render: () => <Harness initial={emptyDoc} onAttachmentUpload={() => new Promise<UploadedAttachment>(() => {})} />,
  play: async ({ canvasElement }) => {
    dropFiles(canvasElement, [new File(['%PDF'], '契約書.pdf', { type: 'application/pdf' })]);
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('status')).toHaveTextContent('「契約書.pdf」を送信中…');
  },
};

/** 送れなかったら仮の表示を消し、理由を知らせる。 */
export const 送信に失敗: Story = {
  render: (args) => (
    <Harness
      initial={emptyDoc}
      onNotice={args.onNotice}
      onAttachmentUpload={async () => {
        throw new Error('500');
      }}
    />
  ),
  args: { onNotice: fn() },
  play: async ({ canvasElement, args }) => {
    dropFiles(canvasElement, [new File(['%PDF'], '契約書.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(args.onNotice).toHaveBeenCalledWith(expect.stringContaining('「契約書.pdf」を添付できませんでした')));
    await expect(within(canvasElement).queryByRole('status')).toBeNull();
  },
};

/** ドロップの振り分け: 画像は画像に、PDF は添付に、html は理由を出して断る。 */
export const ドロップの振り分け: Story = {
  render: (args) => (
    <Harness
      initial={emptyDoc}
      onNotice={args.onNotice}
      onImageUpload={args.onImageUpload}
      onAttachmentUpload={args.onAttachmentUpload}
      downloadAttachment={async () => 'about:blank'}
    />
  ),
  args: {
    onNotice: fn(),
    onImageUpload: fn(async () => 'kb/w/p/1.bin'),
    onAttachmentUpload: fn(async (file: File) => uploaded(file)),
  },
  play: async ({ canvasElement, args }) => {
    const png = new File(['png'], '写真.png', { type: 'image/png' });
    const pdf = new File(['%PDF'], '仕様書.pdf', { type: 'application/pdf' });
    const html = new File(['<script>'], '罠.html', { type: 'text/html' });
    dropFiles(canvasElement, [png, pdf, html]);
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('仕様書.pdf')).toBeVisible();
    await expect(args.onImageUpload).toHaveBeenCalledWith(png);
    await expect(args.onAttachmentUpload).toHaveBeenCalledTimes(1);
    await expect(args.onAttachmentUpload).toHaveBeenCalledWith(pdf);
    await expect(args.onNotice).toHaveBeenCalledWith(expect.stringContaining('「罠.html」'));
  },
};

/** 別のページの添付を貼り付けると、ファイル名だけの段落にして知らせる（同じページの添付はそのまま）。 */
export const 別のページの添付を貼り付ける: Story = {
  render: (args) => <Harness initial={emptyDoc} onNotice={args.onNotice} />,
  args: { onNotice: fn() },
  play: async ({ canvasElement, args }) => {
    const target = canvasElement.querySelector('.ProseMirror') as HTMLElement;
    target.focus();
    const dataTransfer = new DataTransfer();
    dataTransfer.setData(
      'text/html',
      `<div data-attachment data-attachment-id="${ID1}" data-page-id="${PAGE}" data-filename="自分の.pdf">自分の.pdf</div>` +
        `<div data-attachment data-attachment-id="${ID2}" data-page-id="${OTHER_PAGE}" data-filename="他のページの.pdf">他のページの.pdf</div>`,
    );
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
    await waitFor(() => expect(canvasElement.querySelectorAll('.rte-attachment')).toHaveLength(1));
    await expect(within(canvasElement).getByText('自分の.pdf')).toBeVisible();
    await expect(target).toHaveTextContent('他のページの.pdf');
    await expect(args.onNotice).toHaveBeenCalledWith(expect.stringContaining('他のページの.pdf'));
  },
};
