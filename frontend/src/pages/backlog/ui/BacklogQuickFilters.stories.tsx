import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import type { TicketSavedFilter } from '@/entities/ticket';
import BacklogQuickFilters from './BacklogQuickFilters';

const counts = { total: 6, assignedToMe: 2, overdue: 1, unassigned: 2 };

const savedFilter = (over: Partial<TicketSavedFilter> & { id: string; name: string }): TicketSavedFilter => ({
  statusId: null,
  typeId: null,
  labelId: null,
  assigneePrincipalId: null,
  unassigned: false,
  assignedToMe: false,
  overdue: false,
  q: null,
  count: 0,
  createdAt: '2026-09-24T00:00:00Z',
  updatedAt: '2026-09-24T00:00:00Z',
  ...over,
});

const savedFilters = [
  savedFilter({ id: 'f-1', name: '自分の不具合', labelId: 'l-1', assignedToMe: true, count: 2 }),
  savedFilter({ id: 'f-2', name: '期限切れの検索', overdue: true, q: '検索', count: 0 }),
  savedFilter({ id: 'f-3', name: '長い名前の絞り込みは途中で省略されて一覧を崩さない', statusId: 'st-1', count: 12 }),
];

const meta = {
  title: 'pages/backlog/BacklogQuickFilters',
  component: BacklogQuickFilters,
  parameters: { layout: 'padded' },
  args: {
    counts,
    value: null,
    filtered: false,
    onChange: fn(),
    savedFilters,
    savedFilterId: null,
    onSelectSaved: fn(),
    onRenameSaved: fn(async () => undefined),
    onDeleteSaved: fn(),
  },
} satisfies Meta<typeof BacklogQuickFilters>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 固定の 4 つの後ろに、利用者が保存した絞り込みが作った順で並ぶ（設計ボード ST09）。 */
export const 保存した絞り込みが並ぶ: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: /^自分の不具合(?! の操作)/ })).toHaveTextContent('2');
    await expect(canvas.getByRole('button', { name: '自分の不具合 の操作' })).toBeVisible();
  },
};

/** 保存した絞り込みを選んでいるときは、同じ条件を含む固定のタブ（自分の担当）は押されない。 */
export const 保存した絞り込みを選んでいる: Story = {
  args: { value: 'assignedToMe', filtered: true, savedFilterId: 'f-1' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: /^自分の不具合(?! の操作)/ })).toHaveAttribute('aria-pressed', 'true');
    await expect(canvas.getByRole('button', { name: /^自分の担当/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'false');
  },
};

/** 件数が取れなかったら、0 と取り違えないよう「—」。 */
export const 件数が取れない: Story = {
  args: { countsFailed: true, savedCountsFailed: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByLabelText('件数を取得できませんでした')).toHaveLength(6);
  },
};

/** 「…」を押すと名前の変更と削除。名前の変更はタブがその場で入力欄になり、Esc で戻る。 */
export const 名前を変える: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '自分の不具合 の操作' }));
    await userEvent.click(canvas.getByRole('button', { name: '名前を変える' }));
    const input = canvas.getByRole('textbox', { name: '絞り込みの名前' });
    await expect(input).toHaveValue('自分の不具合');
    await expect(input).toHaveFocus();
    await userEvent.clear(input);
    await userEvent.type(input, '自分の不具合（急ぎ）');
    await userEvent.click(canvas.getByRole('button', { name: '名前を変える' }));
    await expect(args.onRenameSaved).toHaveBeenCalledWith(savedFilters[0], '自分の不具合（急ぎ）');
    // 終わったらタブへ戻る。
    await expect(await canvas.findByRole('button', { name: /^自分の不具合(?! の操作)/ })).toHaveFocus();
  },
};

export const 削除は親に委ねる: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: '期限切れの検索 の操作' }));
    await userEvent.click(canvas.getByRole('button', { name: '削除' }));
    await expect(args.onDeleteSaved).toHaveBeenCalledWith(savedFilters[1]);
  },
};

export const 狭い画面: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
