import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import { emptyRichDoc, type RichDocContent } from '@/shared/lib/richDoc';
/**
 * 本文エディタの見本。ナレッジ画面（/kb）での使われ方をそのまま再現する。
 *
 * ここの story は addon-vitest で**そのままテストとして実行される**
 * （play の assertion が落ちると CI が落ちる）。見た目の検証と回帰テストを兼ねる。
 */
const meta = {
  title: 'pages/kb/editor/RichTextEditor',
  component: RichTextEditor,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof RichTextEditor>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 見出し・箇条書き・番号付きを含む見本の本文（リストの印の色の確認も兼ねる）。 */
const sampleDoc = (): RichDocContent => ({
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '10 日間の研修がやっと終わりました。' }],
    },
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'リッチテキストエディタを組み込んだこと' }],
            },
          ],
        },
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: 'データベースの勉強も間に挟んだ' }],
            },
          ],
        },
      ],
    },
    {
      type: 'orderedList',
      content: [
        {
          type: 'listItem',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: '番号付きの項目（印は本文と同じ色）' }],
            },
          ],
        },
      ],
    },
  ],
});

/**
 * ナレッジ画面の形の再現（題名 → 本文）。書式は**選んだときに出るバブル**で変える。
 * 画面上部に固定する帯は置かない（場所を取るわりに、使うのは書式を変える一瞬だけ）。
 */
function KbPageLayout() {
  // 題名で Enter を押したら本文へ移る合図（ナレッジ画面と同じ配線）。
  const [bodyFocusSignal, setBodyFocusSignal] = useState(0);
  return (
    <div style={{ height: '100vh', overflowY: 'auto' }}>
      <div className="mx-auto w-full max-w-3xl px-6 py-10">
        <input
          aria-label="ページの題名"
          defaultValue="研修の振り返り"
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            setBodyFocusSignal((prev) => prev + 1);
          }}
          className="mb-4 w-full border-none bg-transparent p-0 text-3xl font-bold outline-none"
        />
        <RichTextEditor value={sampleDoc()} editable focusSignal={bodyFocusSignal} />
      </div>
    </div>
  );
}

/**
 * 題名で Enter を押すと本文の先頭へ移る。
 *
 * **本物のブラウザで確かめる。** jsdom では、同じ document で何度もエディタを作った後の
 * `focus()` が実際には activeElement を動かさないことがあり、合図を無視する実装でも
 * 単体テストが通ってしまう（合図のガードを外して確認済み）。ここは story として
 * ブラウザで実行し、フォーカスが本当に移ることを見る。
 */
export const 題名でEnterすると本文へ移る: Story = {
  args: { value: emptyRichDoc() },
  render: () => <KbPageLayout />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = await canvas.findByRole('textbox', { name: '本文' });
    const title = canvas.getByRole('textbox', { name: 'ページの題名' });

    title.focus();
    await expect(document.activeElement).toBe(title);

    await userEvent.keyboard('{Enter}');

    await waitFor(async () => {
      await expect(body.contains(document.activeElement)).toBe(true);
    });
  },
};

/** ページを開いただけでは本文がフォーカスを奪わない（マウント時の合図では動かない）。 */
export const 開いただけでは本文にフォーカスしない: Story = {
  args: { value: sampleDoc(), editable: true, focusSignal: 3 },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = await canvas.findByRole('textbox', { name: '本文' });
    await expect(body.contains(document.activeElement)).toBe(false);
  },
};

/** 読み取り専用。書式のバブルも出ない（押せない操作を見せない）。 */
export const 読み取り専用: Story = {
  args: { value: sampleDoc(), editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 本文は出る。
    await waitFor(async () => {
      await expect(canvas.getByText(/研修がやっと終わりました/)).toBeInTheDocument();
    });
    await expect(canvas.queryByRole('toolbar', { name: '書式メニュー' })).not.toBeInTheDocument();
  },
};

/** 空の本文（プレースホルダの確認）。 */
export const 空の本文: Story = {
  args: { value: emptyRichDoc(), editable: true },
};

/** タスクリスト（TaskList / TaskItem）だけの本文。 */
const taskListDoc = (): RichDocContent => ({
  type: 'doc',
  content: [
    {
      type: 'taskList',
      content: [
        {
          type: 'taskItem',
          attrs: { checked: false },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '研修資料を読む' }] }],
        },
        {
          type: 'taskItem',
          attrs: { checked: true },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '環境構築を終える' }] }],
        },
      ],
    },
  ],
});

/**
 * タスクリスト。チェックボックスの大きさと項目間の余白の回帰確認
 * （通常の箇条書きより不自然に間延びして見える不具合があった。jsdom はレイアウトを
 * 持たないため単体テストでは検知できず、ここが唯一の検知場所）。
 */
export const タスクリスト: Story = {
  args: { value: taskListDoc(), editable: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const items = canvasElement.querySelectorAll("li[data-checked]");
    await expect(items).toHaveLength(2);

    // 段落の既定マージンが残ったままだと、flex 化した li との二重計上で
    // 項目間が通常の箇条書きより間延びして見える。
    const paragraph = items[0]!.querySelector('div > p');
    await expect(paragraph).not.toBeNull();
    await expect(getComputedStyle(paragraph!).marginBottom).toBe('0px');

    // チェックボックスは裸のブラウザ既定サイズではなく明示サイズで描く。
    const checkbox = items[0]!.querySelector("input[type='checkbox']");
    await expect(checkbox).not.toBeNull();
    await expect(getComputedStyle(checkbox!).width).toBe('16px');

    await expect(canvas.getByText('環境構築を終える')).toBeInTheDocument();
  },
};
