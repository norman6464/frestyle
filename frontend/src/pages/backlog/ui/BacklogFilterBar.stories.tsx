import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import BacklogFilterBar from './BacklogFilterBar';
import type { Label, TicketStatus, TicketType } from '@/entities/ticket';

const statuses: TicketStatus[] = [
  {
    id: 'st-1',
    workspaceId: 'w-1',
    projectId: 's-1',
    name: 'To Do',
    category: 'todo',
    color: '#5b6b7a',
    position: 'a0',
    isInitial: true,
    archivedAt: null,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    activeTicketCount: 4,
  },
  {
    id: 'st-2',
    workspaceId: 'w-1',
    projectId: 's-1',
    name: '開発',
    category: 'in_progress',
    color: '#a0661a',
    position: 'a1',
    isInitial: false,
    archivedAt: null,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    activeTicketCount: 2,
  },
];

const types: TicketType[] = [
  {
    id: 'ty-1',
    workspaceId: 'w-1',
    projectId: 's-1',
    name: '開発タスク',
    hierarchyLevel: 0,
    color: '#2563eb',
    position: 'a0',
    isDefault: true,
    templateTitle: null,
    templateDoc: null,
    archivedAt: null,
    createdAt: '2026-09-08T00:00:00Z',
    updatedAt: '2026-09-08T00:00:00Z',
    activeTicketCount: 3,
  },
];

const labels: Label[] = [
  { id: 'l-1', name: '不具合', color: '#b3392c', createdAt: '', updatedAt: '' },
  { id: 'l-2', name: 'frontend', color: '#2f6b47', createdAt: '', updatedAt: '' },
];

const meta = {
  title: 'pages/backlog/BacklogFilterBar',
  component: BacklogFilterBar,
  parameters: { layout: 'padded' },
  args: {
    statuses,
    types,
    labels,
    statusId: null,
    typeId: null,
    labelId: null,
    q: '',
    quick: null,
    onChangeStatusId: fn(),
    onChangeTypeId: fn(),
    onChangeLabelId: fn(),
    onChangeQuery: fn(),
    onClearQuick: fn(),
    onClearFilters: fn(),
    onCreate: fn(),
  },
} satisfies Meta<typeof BacklogFilterBar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 条件を何も使っていない日の形。操作列は検索・フィルター・課題をつくる の 3 つだけ。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'フィルター' })).toHaveAttribute('aria-expanded', 'false');
    // 詳細の選択欄は押すまで出ない。
    await expect(canvas.queryByLabelText('状態で絞り込む')).toBeNull();
    await expect(canvas.getByRole('button', { name: '課題をつくる' })).toBeInTheDocument();
  },
};

/** 「フィルター」を押すと 3 つの選択欄が現れる。押した本人が開いたと分かるよう aria-expanded を返す。 */
export const フィルターを開く: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'フィルター' }));
    await expect(canvas.getByRole('button', { name: 'フィルター' })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByLabelText('状態で絞り込む')).toBeInTheDocument();
    await expect(canvas.getByLabelText('種別で絞り込む')).toBeInTheDocument();
    await expect(canvas.getByLabelText('ラベルで絞り込む')).toBeInTheDocument();
    await expect(canvas.getByText('変更はすぐに反映されます')).toBeVisible();
  },
};

/**
 * 絞り込みはネイティブの `<select>` ではなく Base UI の選択欄。候補は別の器（ポータル）へ
 * 描かれるので、探す場所が canvas ではなく document になる。選択欄は「フィルター」を
 * 押してからしか出ないので、先に開く。
 */
async function choose(canvas: ReturnType<typeof within>, label: string, optionName: string) {
  await userEvent.click(canvas.getByRole('button', { name: 'フィルター' }));
  await userEvent.click(canvas.getByLabelText(label));
  await userEvent.click(await within(document.body).findByRole('option', { name: optionName }));
}

export const 状態を選ぶ: Story = {
  play: async ({ canvasElement, args }) => {
    await choose(within(canvasElement), '状態で絞り込む', '開発');
    await expect(args.onChangeStatusId).toHaveBeenCalledWith('st-2');
  },
};

export const ラベルを選ぶ: Story = {
  play: async ({ canvasElement, args }) => {
    await choose(within(canvasElement), 'ラベルで絞り込む', '不具合');
    await expect(args.onChangeLabelId).toHaveBeenCalledWith('l-1');
  },
};

export const 種別を選ぶ: Story = {
  play: async ({ canvasElement, args }) => {
    await choose(within(canvasElement), '種別で絞り込む', '開発タスク');
    await expect(args.onChangeTypeId).toHaveBeenCalledWith('ty-1');
  },
};

/**
 * 条件付きで開いたときは、選択欄が見えた状態で始まり、「フィルター」に適用数が付く。
 * 効いている条件はチップになって、畳んでも消えない。
 */
export const 条件が付いている: Story = {
  args: { statusId: 'st-2', typeId: 'ty-1', quick: 'overdue', q: '認証' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /フィルター/ })).toHaveAttribute('aria-expanded', 'true');
    await expect(canvas.getByLabelText('2 件の条件を適用中')).toBeInTheDocument();
    // チップは 1 つずつ外せる。
    await expect(canvas.getByRole('button', { name: '状態: 開発 の絞り込みを解除' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '種別: 開発タスク の絞り込みを解除' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '期限切れ の絞り込みを解除' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '題名: 認証 の絞り込みを解除' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: '状態: 開発 の絞り込みを解除' }));
    await expect(args.onChangeStatusId).toHaveBeenCalledWith(null);
    await userEvent.click(canvas.getByRole('button', { name: '期限切れ の絞り込みを解除' }));
    await expect(args.onClearQuick).toHaveBeenCalledOnce();
    // 畳んでもチップは残る。
    await userEvent.click(canvas.getByRole('button', { name: /フィルター/ }));
    await expect(canvas.getByRole('button', { name: '種別: 開発タスク の絞り込みを解除' })).toBeVisible();
  },
};

export const すべて解除する: Story = {
  args: { statusId: 'st-2', q: '認証' },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'すべて解除' }));
    await expect(args.onClearFilters).toHaveBeenCalledOnce();
    await expect(canvas.getByRole('searchbox')).toHaveValue('');
  },
};

/** 課題をつくる を渡さなければ出ない（アーカイブの面・読むだけの人）。 */
export const 作成できない面: Story = {
  args: { onCreate: undefined },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).queryByRole('button', { name: '課題をつくる' })).toBeNull();
  },
};

export const 題名検索は入力が止まってから通知する: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText('題名で絞り込む');
    await userEvent.type(input, '認証');
    // デバウンス中はまだ呼ばれない。
    await expect(args.onChangeQuery).not.toHaveBeenCalled();
    await waitFor(() => expect(args.onChangeQuery).toHaveBeenCalledWith('認証'), { timeout: 1000 });
  },
};
