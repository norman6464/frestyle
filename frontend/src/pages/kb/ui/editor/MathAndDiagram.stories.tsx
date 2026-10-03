import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import RichTextEditor from './RichTextEditor';
import type { RichDocContent } from '@/shared/lib/richDoc';

/**
 * 数式（KaTeX）と図（mermaid）。どちらも初めて描くときにだけ読み込む（数式や図の無いページでは
 * 読まれない — LazyRenderers の見本で確かめる）。
 *
 * - 行内の数式は `$式$`、行の数式は空の段落で `$$` と空白。選んで押すか Enter で入力欄が開く
 * - 読めない式は理由と元の式を出す
 * - 図は編集中は左に元の文字・右に描いた図、閲覧モードは図だけ。描けない書式は理由を出す
 */
const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/MathAndDiagram',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

function Harness({ initial, editable = true }: { initial: RichDocContent; editable?: boolean }) {
  const [value, setValue] = useState<RichDocContent>(initial);
  return (
    <div style={{ width: 742 }}>
      <RichTextEditor value={value} editable={editable} onChange={setValue} ariaLabel="本文" />
    </div>
  );
}

const mathDoc: RichDocContent = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '質量とエネルギーの関係は ' },
        { type: 'inlineMath', attrs: { latex: 'E=mc^2' } },
        { type: 'text', text: ' で表せる。' },
      ],
    },
    { type: 'blockMath', attrs: { latex: '\\int_0^1 x^2\\,dx = \\frac{1}{3}' } },
  ],
};

/** 行内の数式と行の数式。 */
export const 数式: Story = {
  render: () => <Harness initial={mathDoc} />,
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(canvasElement.querySelectorAll('.katex')).toHaveLength(2);
    });
    await expect(canvasElement.querySelector('.rte-math-block .katex-display')).not.toBeNull();
    // 読み上げ用の MathML も出ている。
    await expect(canvasElement.querySelector('.rte-math-inline math')).not.toBeNull();
  },
};

/** 行の数式を押すと入力欄が開き、書き換えると描き直す。Esc で閉じる。 */
export const 数式を書き換える: Story = {
  render: () => <Harness initial={mathDoc} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvasElement.querySelector('.rte-math-block .katex')).not.toBeNull();
    });
    const block = canvasElement.querySelector('.rte-math-block') as HTMLElement;
    await userEvent.click(block);
    const input = await canvas.findByRole('textbox', { name: '数式（LaTeX）' });
    await userEvent.clear(input);
    await userEvent.type(input, 'a^2+b^2=c^2');
    await waitFor(async () => {
      await expect(canvasElement.querySelector('.rte-math-block annotation')).toHaveTextContent('a^2+b^2=c^2');
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(canvas.queryByRole('textbox', { name: '数式（LaTeX）' })).toBeNull();
    });
  },
};

/** 読めない式は、理由と元の式を出す。 */
export const 読めない数式: Story = {
  render: () => (
    <Harness
      initial={{ type: 'doc', content: [{ type: 'blockMath', attrs: { latex: '\\frac{1}{' } }] }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/数式を読めません/)).toBeInTheDocument();
    await expect(canvasElement.querySelector('.rte-math-error code')).toHaveTextContent('\\frac{1}{');
  },
};

const diagramDoc: RichDocContent = {
  type: 'doc',
  content: [
    {
      type: 'diagram',
      attrs: { engine: 'mermaid' },
      content: [{ type: 'text', text: 'graph TD\n  申請 --> 承認\n  承認 --> 完了' }],
    },
  ],
};

/** 図。編集中は左に元の文字、右に描いた図。 */
export const 図: Story = {
  render: () => <Harness initial={diagramDoc} />,
  play: async ({ canvasElement }) => {
    await waitFor(
      async () => {
        await expect(canvasElement.querySelector('.rte-diagram-svg svg')).not.toBeNull();
      },
      { timeout: 10000 },
    );
    await expect(canvasElement.querySelector('.rte-diagram-svg svg')).toHaveTextContent('申請');
    await expect(canvasElement.querySelector('.rte-diagram-source')).toBeVisible();
  },
};

/** 閲覧モードの図は、描いた図だけを出す。 */
export const 閲覧モードの図: Story = {
  render: () => <Harness initial={diagramDoc} editable={false} />,
  play: async ({ canvasElement }) => {
    await waitFor(
      async () => {
        await expect(canvasElement.querySelector('.rte-diagram-svg svg')).not.toBeNull();
      },
      { timeout: 10000 },
    );
    await expect(canvasElement.querySelector('.rte-diagram-source')).not.toBeVisible();
  },
};

/** 描けない書式は、図の代わりに理由を出す。 */
export const 描けない図: Story = {
  render: () => (
    <Harness
      initial={{
        type: 'doc',
        content: [{ type: 'diagram', attrs: { engine: 'mermaid' }, content: [{ type: 'text', text: 'graph TD\n  A -->' }] }],
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(/図を描けません/, undefined, { timeout: 10000 })).toBeInTheDocument();
    await expect(canvasElement.querySelector('.rte-diagram-svg')).toBeNull();
  },
};
