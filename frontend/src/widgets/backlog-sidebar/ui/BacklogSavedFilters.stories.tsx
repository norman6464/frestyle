import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { withRouter } from '../../../../.storybook/decorators';
import BacklogSavedFilters from './BacklogSavedFilters';

/**
 * サイドバーの「保存した絞り込み」（自分の担当・期限切れ・未割り当て）。
 * バックログの一覧フィルタへのリンクで、件数は呼び出し側（KbSidebar）が 1 回だけ取って渡す。
 */
const meta = {
  title: 'widgets/kb-sidebar/BacklogSavedFilters',
  component: BacklogSavedFilters,
  args: { projectId: 's-1', counts: { total: 18, assignedToMe: 4, overdue: 2, unassigned: 3 } },
  decorators: [withRouter],
  parameters: { layout: 'padded' },
} satisfies Meta<typeof BacklogSavedFilters>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 期限切れが 1 件以上あるときは、その数字だけ赤で出す（対処が要る合図）。 */
export const 件数あり: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('link', { name: /自分の担当/ })).toHaveAttribute(
      'href',
      '/backlog/s-1?assignedToMe=1',
    );
    await expect(canvas.getByText('4')).toBeVisible();
    await expect(canvas.getByText('2')).toHaveClass(/text-danger-ink/);
  },
};

/** 期限切れが 0 のときは赤くしない（0 件は知らせではない）。 */
export const 期限切れなし: Story = {
  args: { counts: { total: 12, assignedToMe: 4, overdue: 0, unassigned: 3 } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('0')).not.toHaveClass(/text-danger-ink/);
  },
};

/** 件数がまだ取れていないとき。行は出し、数字だけ出さない。 */
export const 件数がまだ無い: Story = {
  args: { counts: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('link', { name: '未割り当て' })).toBeVisible();
  },
};
