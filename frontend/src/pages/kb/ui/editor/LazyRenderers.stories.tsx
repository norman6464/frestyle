import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor } from 'storybook/test';
import RichTextEditor from './RichTextEditor';

/**
 * 数式（KaTeX）と図（mermaid）は、使うページでだけ読み込む。
 *
 * この見本は「描くときに取りに行く」ことをブラウザが実際に取りに行ったもので確かめる。見本は
 * 上から順に同じ画面で動き、一度読み込んだ部品は次の見本でも取りに行かれないので、**数式や図の
 * 無い本文を先に**置く。見本の部品は見本が動く前に読み込まれるので、「最初から import してしまう」
 * 誤りはここでは捕まらない — それはビルド後の scripts/check-lazy-renderers.mjs が止める。
 *
 * 記録は見本ごとに PerformanceObserver で取る。performance.getEntriesByType('resource') は既定で
 * 250 件までしか溜めず、開発サーバーは部品を数百個配るので溢れて記録されない（実際に、数式を
 * 描いたのに KaTeX が一覧に出なかった）。PerformanceObserver なら溢れに関係なく届く。
 */
const fetched: string[] = [];

const meta: Meta<typeof RichTextEditor> = {
  title: 'pages/kb/editor/LazyRenderers',
  component: RichTextEditor,
  parameters: { layout: 'padded' },
  beforeEach: () => {
    fetched.length = 0;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) fetched.push(entry.name);
    });
    observer.observe({ type: 'resource' });
    return () => observer.disconnect();
  },
};

export default meta;
type Story = StoryObj<typeof RichTextEditor>;

function loaded(pattern: RegExp): string[] {
  return fetched.filter((name) => pattern.test(name));
}

/** 数式も図も無い本文では、KaTeX も mermaid も取りに行かない。 */
export const 数式も図も無い本文では読み込まない: Story = {
  render: () => (
    <div style={{ width: 742 }}>
      <RichTextEditor
        value={{ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'ふつうの本文' }] }] }}
        editable
        onChange={() => {}}
        ariaLabel="本文"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(canvasElement.querySelector('.ProseMirror')).toHaveTextContent('ふつうの本文');
    });
    // 描き終わるまで少し待ってから、取りに行ったものを見る。
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(loaded(/katex/i)).toEqual([]);
    await expect(loaded(/mermaid/i)).toEqual([]);
  },
};

/** 数式のある本文では KaTeX を取りに行く（図が無いので mermaid は取りに行かない）。 */
export const 数式のある本文では数式だけ読み込む: Story = {
  render: () => (
    <div style={{ width: 742 }}>
      <RichTextEditor
        value={{ type: 'doc', content: [{ type: 'blockMath', attrs: { latex: 'x^2' } }] }}
        editable
        onChange={() => {}}
        ariaLabel="本文"
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(canvasElement.querySelector('.katex')).not.toBeNull();
    });
    await waitFor(async () => {
      await expect(loaded(/katex/i).length).toBeGreaterThan(0);
    });
    await expect(loaded(/mermaid/i)).toEqual([]);
  },
};
