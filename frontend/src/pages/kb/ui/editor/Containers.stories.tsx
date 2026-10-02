import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';

/**
 * 容器 3 種 — 注意書き（callout）・折りたたみ（details）・段組み（columns）。
 *
 * - 注意書きは左に印、地は種類ごとの淡い色（info は brand、success / danger / warning は状態色）。
 *   種類の切り替えは取っ手のメニューから
 * - 折りたたみは閲覧モードでも開閉できる（保存されるのは書いた人が決めた既定の open だけ）
 * - 段組みは 2〜3 列。狭い画面（860px 未満）では縦に積む。列の中に容器は入れ子にしない
 * - 容器の中の段落にもコメントが付く（ブロックの id は中の段落に付いている）
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/Containers',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

const CALLOUT_PARAGRAPH_ID = 'a1b2c3d4-0000-4000-8000-00000000c001';

const containersDoc: RichDocContent = {
  type: 'doc',
  content: [
    {
      type: 'callout',
      attrs: { kind: 'info' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '情報: 既定の種類。補足や前提を書く。' }] }],
    },
    {
      type: 'callout',
      attrs: { kind: 'warning' },
      content: [
        {
          type: 'paragraph',
          attrs: { id: CALLOUT_PARAGRAPH_ID },
          content: [{ type: 'text', text: '注意: 気をつけてほしいこと。この段落にはコメントが 2 件付いている。' }],
        },
      ],
    },
    {
      type: 'callout',
      attrs: { kind: 'danger' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '危険: 取り返しがつかない操作。' }] }],
    },
    {
      type: 'callout',
      attrs: { kind: 'success' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '成功: うまくいった手順。' }] }],
    },
    {
      type: 'details',
      attrs: { open: true },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: '折りたたみ（開いた状態で保存）' }] },
        {
          type: 'detailsContent',
          content: [
            { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '中の見出しも目次に出る' }] },
            { type: 'paragraph', content: [{ type: 'text', text: '折りたたみの中身。' }] },
          ],
        },
      ],
    },
    {
      type: 'columns',
      attrs: { count: 2 },
      content: [
        { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: '左の列。狭い画面では上に来る。' }] }] },
        { type: 'column', content: [{ type: 'paragraph', content: [{ type: 'text', text: '右の列。狭い画面では下に来る。' }] }] },
      ],
    },
  ],
};

function Harness({ width, editable = true }: { width?: number; editable?: boolean }) {
  const [value, setValue] = useState<RichDocContent>(containersDoc);
  return (
    // 幅を指定する見本（狭い・広い）では max-w で縮めない（768px に収まると 860px 未満の縦積みになる）。
    <div style={width ? { width } : undefined} className={width ? undefined : 'max-w-3xl'}>
      <RichTextEditor
        value={value}
        editable={editable}
        onChange={setValue}
        ariaLabel="本文"
        commentBadgeCounts={{ [CALLOUT_PARAGRAPH_ID]: 2 }}
      />
    </div>
  );
}

/** 3 種の容器。注意書きの 4 種類の色、開いた折りたたみ、2 列の段組み。 */
export const 三種の容器: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll('.rte-callout')).toHaveLength(4);
    await expect(canvasElement.querySelector('.rte-callout[data-kind="warning"]')).not.toBeNull();
    await expect(canvasElement.querySelector('[data-type="details"].is-open')).not.toBeNull();
    await expect(canvasElement.querySelector('.rte-columns[data-count="2"]')).not.toBeNull();
    // 容器の中の段落にもコメントの札が付く。
    const badge = await within(canvasElement).findByText('2');
    await expect(badge.closest('.rte-callout')).not.toBeNull();
  },
};

/** 取っ手のメニューから注意書きの種類を切り替える。 */
export const 注意書きの種類を切り替える: Story = {
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const info = canvasElement.querySelector('.rte-callout[data-kind="info"]') as HTMLElement;
    await userEvent.hover(info);
    await userEvent.click(await canvas.findByRole('button', { name: 'ブロックの操作' }));
    await userEvent.click(await canvas.findByRole('menuitem', { name: '種類: 成功' }));
    await waitFor(async () => {
      await expect(canvasElement.querySelectorAll('.rte-callout[data-kind="success"]')).toHaveLength(2);
    });
  },
};

/** 狭い画面（600px）では段組みが縦に積まれる。 */
export const 狭い画面では縦積み: Story = {
  render: () => <Harness width={600} />,
  play: async ({ canvasElement }) => {
    const columns = canvasElement.querySelector('.rte-columns') as HTMLElement;
    await waitFor(async () => {
      const tracks = getComputedStyle(columns).gridTemplateColumns.trim().split(/\s+/);
      await expect(tracks).toHaveLength(1);
    });
  },
};

/** 広い画面（900px）では 2 列に並ぶ。 */
export const 広い画面では横並び: Story = {
  render: () => <Harness width={900} />,
  play: async ({ canvasElement }) => {
    const columns = canvasElement.querySelector('.rte-columns') as HTMLElement;
    await waitFor(async () => {
      const tracks = getComputedStyle(columns).gridTemplateColumns.trim().split(/\s+/);
      await expect(tracks).toHaveLength(2);
    });
  },
};

const closedDetailsDoc: RichDocContent = {
  type: 'doc',
  content: [
    {
      type: 'details',
      attrs: { open: false },
      content: [
        { type: 'detailsSummary', content: [{ type: 'text', text: '閲覧モードでも開ける' }] },
        { type: 'detailsContent', content: [{ type: 'paragraph', content: [{ type: 'text', text: '隠れていた中身' }] }] },
      ],
    },
  ],
};

/** 閲覧モード（editable=false）でも折りたたみを開閉できる。保存はされない。 */
export const 閲覧モードでも開閉できる: Story = {
  render: () => (
    <div className="max-w-2xl">
      <RichTextEditor value={closedDetailsDoc} editable={false} onChange={() => {}} ariaLabel="本文" />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('隠れていた中身')).not.toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '折りたたみを開く' }));
    await waitFor(async () => {
      await expect(canvas.getByText('隠れていた中身')).toBeVisible();
    });
    await expect(canvas.getByRole('button', { name: '折りたたみを閉じる' })).toBeInTheDocument();
  },
};
