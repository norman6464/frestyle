import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, within } from 'storybook/test';
import ErrorBoundary from './ErrorBoundary';

/**
 * 画面のどこかが描画に失敗したときの受け皿。
 *
 * これが無いと、1 か所の失敗で**画面がまるごと真っ白**になり、戻る手段も無くなる。
 * ここで受け止めて、何が起きたかと「もう一度試す」を出す。
 *
 * 「再試行」は状態を戻すだけで、原因は直さない。同じ操作で必ず失敗するなら押しても
 * また同じ画面になる — それでも押せるようにしてあるのは、一時的な失敗（通信の瞬断など）
 * のほうが多く、その場合は 1 回で戻れるため。
 */
const meta = {
  title: 'app/ErrorBoundary',
  component: ErrorBoundary,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="min-h-[420px] bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 失敗させるための子。描画のたびに投げる。 */
function AlwaysFails(): never {
  throw new Error('見本のための失敗');
}

/** 何も起きていないとき。子をそのまま出すだけで、自分では何も描かない。 */
export const 平常時: Story = {
  args: {
    children: (
      <div className="p-8">
        <h1 className="text-2xl font-bold text-[var(--color-text-primary)]">ふつうの画面</h1>
        <p className="mt-2 text-sm text-[var(--color-text-secondary)]">
          失敗していないときは、この受け皿は何も足さない。
        </p>
      </div>
    ),
  },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('heading', { name: 'ふつうの画面' })).toBeVisible();
  },
};

/**
 * 子が描画に失敗したとき。
 *
 * React は受け止めたあとも失敗の内容をコンソールへ出す。見本を開くと赤い記録が出るが、
 * これは受け皿が働いている証で、壊れているわけではない。
 */
export const 失敗を受け止めたところ: Story = {
  args: { children: <AlwaysFails /> },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'エラーが発生しました' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '再試行' })).toBeVisible();
    // 再試行で直らないときの逃げ道。
    await expect(canvas.getByRole('button', { name: '再読み込み' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'ホームへ' })).toHaveAttribute('href', '/');
  },
};

/** 「再試行」を押したところ。直せる失敗なら、元の中身が戻る。 */
export const 再試行で戻る: Story = {
  args: { children: null },
  render: () => {
    // 1 回だけ失敗する子。押し直せば戻る、という一時的な失敗を再現する。
    let failed = false;
    function FailsOnce() {
      if (!failed) {
        failed = true;
        throw new Error('一度きりの失敗');
      }
      return <p className="p-8 text-sm text-[var(--color-text-secondary)]">戻ってきた中身</p>;
    }
    return (
      <ErrorBoundary>
        <FailsOnce />
      </ErrorBoundary>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(canvas.getByText('戻ってきた中身')).toBeVisible();
  },
};
