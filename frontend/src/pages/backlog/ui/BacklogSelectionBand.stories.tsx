import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import BacklogSelectionBand from './BacklogSelectionBand';

const meta = {
  title: 'pages/backlog/BacklogSelectionBand',
  component: BacklogSelectionBand,
  parameters: { layout: 'padded' },
  args: {
    variant: 'header',
    selectedKey: 'FRESTYLE-457',
    groupName: 'バックログ',
    isFirst: false,
    isLast: false,
    canReorder: true,
    onMoveUp: fn(),
    onMoveDown: fn(),
    onMoveLast: fn(),
    onDeselect: fn(),
  },
} satisfies Meta<typeof BacklogSelectionBand>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 選択中の帯（設計ボード ST14 の 01）。選択中のチケット・いる段・選択解除と並び替えを 1 か所に。
 * 選択解除は ✕ の絵だけにせず文字で出す。
 */
export const 詳細の上: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 2 })).toHaveTextContent('選択中 FRESTYLE-457 · バックログ');
    await userEvent.click(canvas.getByRole('button', { name: /1 つ上へ/ }));
    await expect(args.onMoveUp).toHaveBeenCalled();
    await userEvent.click(canvas.getByRole('button', { name: '選択解除' }));
    await expect(args.onDeselect).toHaveBeenCalled();
  },
};

/** 動かした結果は帯の中に出し、読み上げにも届ける。 */
export const 動かした結果を知らせる: Story = {
  args: { message: 'FRESTYLE-457 を 1 つ上へ動かしました' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('status')).toHaveTextContent('FRESTYLE-457 を 1 つ上へ動かしました');
  },
};

export const 先頭では上へを押せない: Story = {
  args: { isFirst: true },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /1 つ上へ/ })).toBeDisabled();
  },
};

/** スプリントに入っているときは、ほかのスプリントへの移し替えと「スプリントから出す」。 */
export const スプリントの中: Story = {
  args: {
    groupName: 'スプリント 1',
    sprints: [{ id: 'sp-2', name: 'スプリント 2' }],
    onMoveToSprint: fn(),
    onRemoveFromSprint: fn(),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'スプリントから出す' }));
    await expect(args.onRemoveFromSprint).toHaveBeenCalled();
    await userEvent.click(canvas.getByLabelText('入れ先のスプリント'));
    await userEvent.click(await within(document.body).findByRole('option', { name: 'スプリント 2' }));
    await expect(args.onMoveToSprint).toHaveBeenCalledWith('sp-2');
  },
};

/** アーカイブの面・読むだけの人には並び替えを出さない（選択解除だけ）。 */
export const 並び替えなし: Story = {
  args: { canReorder: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: /1 つ上へ/ })).toBeNull();
    await expect(canvas.getByRole('button', { name: '選択解除' })).toBeVisible();
  },
};

/** 狭い画面では一覧の下に出て、「選択した課題をひらく」で全画面の詳細へ（ST12）。 */
export const 一覧の下: Story = {
  args: { variant: 'bottom', onOpenDetail: fn() },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement, args }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: '選択した課題をひらく' }));
    await expect(args.onOpenDetail).toHaveBeenCalled();
  },
};
