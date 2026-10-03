import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor, { type RichTextEditorProps } from './RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';

/**
 * 埋め込み（第 7 段）。YouTube の動画を「押すまで読み込まない」カードで本文に置く。
 *
 * - 本文を開いただけでは YouTube へ一切繋がない（サムネイルも取らない）。押したときに初めて
 *   youtube-nocookie.com の iframe を作る
 * - 空の行に動画の URL だけを貼ると埋め込みになる（youtube.com/watch・youtu.be・shorts）。文の途中の URL・
 *   読み取れない URL は素のリンクのまま
 * - '/' の「埋め込み」で URL を入れる欄が開く。読み取れない URL は理由を出して閉じない
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/Embeds',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const ID = 'M7lc1UVf-VE';

function Harness({ initial, ...props }: { initial: RichDocContent } & Partial<RichTextEditorProps>) {
  const [value, setValue] = useState<RichDocContent>(initial);
  return (
    <div style={{ width: 742 }}>
      <RichTextEditor value={value} onChange={setValue} ariaLabel="本文" {...props} />
    </div>
  );
}

const savedDoc: RichDocContent = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: '10 月の説明会の録画です。' }] },
    { type: 'embed', attrs: { provider: 'youtube', videoId: ID, title: '10 月の説明会の録画（新しい評価制度について）' } },
    { type: 'paragraph' },
  ],
};

const emptyDoc: RichDocContent = { type: 'doc', content: [{ type: 'paragraph' }] };

/**
 * YouTube（と画像の配信元）への通信を、描く前から数える。performance の資源の記録は既定 250 件で
 * 溢れる（開発サーバーは数百のファイルを配る）ので、記録の一覧ではなく観測で拾う。
 */
const youtubeRequests: string[] = [];
let observer: PerformanceObserver | null = null;
function watchYoutubeRequests() {
  youtubeRequests.length = 0;
  observer?.disconnect();
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      if (/youtube|ytimg|googlevideo/.test(entry.name)) youtubeRequests.push(entry.name);
    }
  });
  observer.observe({ type: 'resource', buffered: false });
  return () => observer?.disconnect();
}

/** 本文を開いただけでは YouTube へ繋がない。iframe も画像も作らず、題名と再生ボタンだけを描く。 */
export const 押すまで読み込まない: Story = {
  beforeEach: watchYoutubeRequests,
  render: () => <Harness initial={savedDoc} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('10 月の説明会の録画（新しい評価制度について）')).toBeVisible();
    await expect(canvas.getByText('押すまで YouTube には接続しません')).toBeVisible();
    // 描き終えてからしばらく待っても、繋がっていない。
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(canvasElement.querySelector('.rte-embed iframe')).toBeNull();
    await expect(canvasElement.querySelector('.rte-embed img')).toBeNull();
    await expect(youtubeRequests).toEqual([]);
  },
};

/** 押すと youtube-nocookie.com の iframe を、決めた制限つきで作る。 */
export const 押すと再生する: Story = {
  render: () => <Harness initial={savedDoc} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /を再生（YouTube を読み込みます）/ }));
    const iframe = canvasElement.querySelector('.rte-embed iframe') as HTMLIFrameElement;
    await expect(iframe).not.toBeNull();
    await expect(iframe.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${ID}?autoplay=1`);
    await expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-presentation');
    await expect(iframe.getAttribute('referrerpolicy')).toBe('strict-origin-when-cross-origin');
  },
};

/** 閲覧モードでも同じカード。押すまで読み込まない。 */
export const 閲覧モード: Story = {
  render: () => <Harness initial={savedDoc} editable={false} />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('.rte-embed iframe')).toBeNull();
    await expect(within(canvasElement).getByRole('button', { name: /を再生/ })).toBeEnabled();
  },
};

/** 題名が無ければ「YouTube の動画」と出す。 */
export const 題名なし: Story = {
  render: () => (
    <Harness initial={{ type: 'doc', content: [{ type: 'embed', attrs: { provider: 'youtube', videoId: ID } }, { type: 'paragraph' }] }} />
  ),
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('YouTube の動画')).toBeVisible();
  },
};

function pasteText(target: HTMLElement, text: string) {
  const dataTransfer = new DataTransfer();
  dataTransfer.setData('text/plain', text);
  target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dataTransfer, bubbles: true, cancelable: true }));
}

/** 空の行に貼った動画の URL（3 つの形）は埋め込みになる。読み取れない URL は素のリンクのまま。 */
export const URLを貼って埋め込む: Story = {
  render: () => <Harness initial={emptyDoc} />,
  play: async ({ canvasElement }) => {
    const target = canvasElement.querySelector('.ProseMirror') as HTMLElement;
    const urls = [
      `https://www.youtube.com/watch?v=${ID}`,
      `https://youtu.be/${ID}?si=share`,
      `https://www.youtube.com/shorts/${ID}`,
    ];
    for (const [index, url] of urls.entries()) {
      // 空の行（最後の段落）にカーソルを置いて貼る。
      await userEvent.click(target.lastElementChild as HTMLElement);
      pasteText(target, url);
      await waitFor(() => expect(canvasElement.querySelectorAll('.rte-embed')).toHaveLength(index + 1));
    }
    await userEvent.click(target.lastElementChild as HTMLElement);
    pasteText(target, 'https://example.com/video');
    await waitFor(() => expect(target).toHaveTextContent('https://example.com/video'));
    await expect(canvasElement.querySelectorAll('.rte-embed')).toHaveLength(3);
  },
};

/** '/' の「埋め込み」で URL を入れる欄が開く。読み取れない URL は理由を出し、読み取れれば置いて閉じる。 */
export const スラッシュから埋め込む: Story = {
  render: () => <Harness initial={emptyDoc} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const target = canvasElement.querySelector('.ProseMirror') as HTMLElement;
    await userEvent.click(target);
    await userEvent.keyboard('/embed');
    await userEvent.click(await within(document.body).findByText('埋め込み'));
    const form = await canvas.findByRole('form', { name: '埋め込みの設定' });
    const input = within(form).getByRole('textbox', { name: '埋め込む動画の URL' });
    await expect(input).toHaveFocus();
    await userEvent.type(input, 'https://example.com/video{Enter}');
    await expect(within(form).getByRole('alert')).toHaveTextContent('YouTube の動画の URL');
    await userEvent.clear(input);
    await userEvent.type(input, `https://youtu.be/${ID}{Enter}`);
    await waitFor(() => expect(canvas.queryByRole('form', { name: '埋め込みの設定' })).toBeNull());
    await expect(canvasElement.querySelectorAll('.rte-embed')).toHaveLength(1);
  },
};
