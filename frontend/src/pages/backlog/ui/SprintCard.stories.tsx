import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import SprintCard from './SprintCard';
import type { Sprint } from '@/entities/sprint';
import type { Ticket } from '@/entities/ticket';

/** 中身の見本。並べ替えの端の判定（先頭は上へ行けない・末尾は下へ行けない）を見るため 3 件。 */
const sprintTickets: Ticket[] = [1, 2, 3].map((n) => ({
  id: `t-${n}`,
  workspaceId: 'w-1',
  projectId: 'p-1',
  number: 100 + n,
  typeId: 'ty-1',
  statusId: 'st-1',
  parentId: null,
  title: `${n} 件目の仕事`,
  doc: { type: 'doc', content: [] },
  priority: 2,
  storyPoints: null,
  teamId: null,
  startDate: null,
  dueDate: null,
  position: `a${n}`,
  closedAt: null,
  resolution: null,
  createdByUserId: 1,
  assigneePrincipalId: null,
  archivedAt: null,
  createdAt: '',
  updatedAt: '',
  labels: [],
}));

const base: Sprint = {
  id: 'sp-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  name: 'スプリント 1',
  state: 'planned',
  position: 'a0',
  ticketCount: 0,
  createdAt: '2026-09-13T00:00:00Z',
  updatedAt: '2026-09-13T00:00:00Z',
};

const meta = {
  title: 'pages/backlog/SprintCard',
  component: SprintCard,
  parameters: { layout: 'padded' },
  args: {
    sprint: base,
    canEdit: true,
    busy: false,
    onChangeState: fn(),
    onUpdate: fn(),
    onDelete: fn(),
    onRemoveTicket: fn(),
    onMoveTicket: fn(),
    projectKey: 'FRESTYLE',
  },
} satisfies Meta<typeof SprintCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 計画中。開始のボタンが出て、期間は「日付を追加」になる。 */
export const 計画中: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('計画中')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'スプリントを開始する' })).toBeInTheDocument();
    await expect(canvas.getByText('日付を追加')).toBeInTheDocument();
  },
};

/** 進行中。開始ではなく完了のボタンに変わる。 */
export const 進行中: Story = {
  args: {
    sprint: { ...base, state: 'active', startDate: '2026-09-15', endDate: '2026-09-29', ticketCount: 8 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('進行中')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'スプリントを完了する' })).toBeInTheDocument();
    await expect(canvas.getByText('9/15 〜 9/29')).toBeInTheDocument();
    await expect(canvas.getByText('（8 件の作業項目）')).toBeInTheDocument();
  },
};

/**
 * 完了。終わったスプリントは記録なので、開始も完了も期間の編集も出さない
 * （backend も 409 で拒む。押せるのに必ず断られるボタンを置かない）。
 */
export const 完了: Story = {
  args: {
    sprint: { ...base, state: 'completed', startDate: '2026-09-01', endDate: '2026-09-14', ticketCount: 12 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText('完了')).toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'スプリントを開始する' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: 'スプリントを完了する' })).not.toBeInTheDocument();
    await expect(canvas.getByText('9/1 〜 9/14')).toBeInTheDocument();
  },
};

/** 見るだけの人。操作のボタンは出ない。 */
export const 権限なし: Story = {
  args: { canEdit: false, sprint: { ...base, state: 'active', ticketCount: 3 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: 'スプリントを完了する' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: '削除' })).not.toBeInTheDocument();
  },
};

/** 期間の前後が逆だと保存させない（backend が 400 で拒む条件を押す前に止める）。 */
export const 期間が逆のときは保存できない: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('日付を追加'));

    const start = canvas.getByLabelText('開始');
    const end = canvas.getByLabelText('終了');
    await userEvent.type(start, '2026-09-30');
    await userEvent.type(end, '2026-09-01');

    await expect(canvas.getByRole('button', { name: '保存' })).toBeDisabled();
    await expect(canvas.getByRole('alert')).toHaveTextContent('終了は開始より後にしてください。');
  },
};

/**
 * 中身がある進行中。並べ替えは端で止まる（先頭は上へ行けない・末尾は下へ行けない）。
 * ドラッグではなくボタンで動かす —— バックログの並べ替えと同じ流儀に揃えてある。
 */
export const 中身の並べ替え: Story = {
  args: { sprint: { ...base, state: 'active', ticketCount: 3 }, tickets: sprintTickets },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('button', { name: '1 件目の仕事 を 1 つ上へ' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: '3 件目の仕事 を 1 つ下へ' })).toBeDisabled();

    // 2 件目を 1 つ上へ = 1 件目の「手前」へ置く。
    await userEvent.click(canvas.getByRole('button', { name: '2 件目の仕事 を 1 つ上へ' }));
    await expect(args.onMoveTicket).toHaveBeenCalledWith('t-2', 't-1', false);
  },
};

/** 完了したスプリントの中身は動かせない（backend も 409 で拒む）。 */
export const 完了したスプリントの中身は動かせない: Story = {
  args: { sprint: { ...base, state: 'completed', ticketCount: 3 }, tickets: sprintTickets },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole('button', { name: '2 件目の仕事 を 1 つ上へ' })).not.toBeInTheDocument();
    await expect(canvas.queryByRole('button', { name: /をスプリントから外す/ })).not.toBeInTheDocument();
  },
};
