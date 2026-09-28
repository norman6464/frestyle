import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import BacklogSettingsPage from './BacklogSettingsPage';
import { backlogRoute, withApi, withToast } from '../../../../.storybook/decorators';
import { baseApi, sprintApi } from './__fixtures__/backlogApi';

/**
 * 本番と同じくバックログの親ルートの中に置く。親ルートがプロジェクトを取りに行くので、経路は
 * API の見本より内側（decorators の配列の先頭）に置く（先に書いたものほど内側になる）。
 */
const route = backlogRoute('/backlog/:projectId/settings', '/backlog/p-1/settings');

const meta = {
  title: 'pages/backlog/BacklogSettingsPage',
  component: BacklogSettingsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast],
} satisfies Meta<typeof BacklogSettingsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 設定の面。状態・種別・スプリントの管理をここに集める。 */
export const 設定の面: Story = {
  decorators: [route, withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      // 状態と種別の管理はどちらも色を選ぶ口を持つので、件数で見る（一覧には 1 つも無い）。
      await expect(canvas.getAllByLabelText('色')).toHaveLength(2);
    });
    // スプリントの改名・期間・削除もこの面。バックログの面には置かない。
    await expect(canvas.getByRole('button', { name: 'スプリントを作成' })).toBeInTheDocument();
    await expect(canvas.getByRole('heading', { level: 1, name: '設定' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: '設定' })).toHaveAttribute('aria-current', 'page');
  },
};

/** 一覧の面だけが使うもの（件数・保存した絞り込み）は、設定の面では取りに行かない。 */
const listOnlyCalls = { counts: 0, savedFilters: 0 };
export const 設定の面は一覧の件数を取りに行かない: Story = {
  decorators: [
    route,
    withApi(
      baseApi({
        '/workspaces/acme/projects/p-1/tickets/counts': () => {
          listOnlyCalls.counts += 1;
          return { total: 0, assignedToMe: 0, overdue: 0, unassigned: 0 };
        },
        '/workspaces/acme/projects/p-1/saved-filters': () => {
          listOnlyCalls.savedFilters += 1;
          return { savedFilters: [] };
        },
      }),
    ),
  ],
  // 描く前に数え直す（描いている途中の取得も数える）。
  beforeEach: () => {
    listOnlyCalls.counts = 0;
    listOnlyCalls.savedFilters = 0;
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getAllByLabelText('色')).toHaveLength(2);
    });
    await expect(listOnlyCalls).toEqual({ counts: 0, savedFilters: 0 });
  },
};

/**
 * スプリントの削除は確認を挟む（中のチケットはバックログへ戻り、スプリントは元に戻せない）。
 * 取り消せば何も起きない。
 *
 * スタブの宛先は前から順の部分一致なので、スプリントの鍵は `/workspaces/acme/projects` より先に置く。
 */
export const スプリントの削除は確認してから: Story = {
  decorators: [
    route,
    withApi({
      '/workspaces/acme/projects/p-1/sprints': {
        sprints: [
          {
            id: 's-1',
            workspaceId: 'w-1',
            projectId: 'p-1',
            name: 'スプリント 12',
            state: 'planned',
            startDate: '2026-09-01',
            endDate: '2026-09-14',
            position: 'a0',
            ticketCount: 2,
            createdAt: '2026-09-01T00:00:00Z',
            updatedAt: '2026-09-01T00:00:00Z',
          },
        ],
      },
      '/workspaces/acme/sprints/s-1/tickets': { ticketIds: ['t-1', 't-2'] },
      ...baseApi(),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('スプリント 12');
    await userEvent.click(canvas.getByRole('button', { name: '削除' }));
    const dialog = await screen.findByRole('dialog', { name: 'スプリントを削除しますか？' });
    await expect(dialog).toHaveTextContent('中の 2 件のチケットは消えず、バックログへ戻ります');
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog')).toBeNull();
    });
    await expect(canvas.getByText('スプリント 12')).toBeInTheDocument();
  },
};

/** 設定の面では名前の欄を開く。連番を入れておき、Esc で欄だけを閉じて作成ボタンへ戻る。 */
export const 設定ではスプリントの名前を決めて作る: Story = {
  decorators: [route, withApi(sprintApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'スプリントを作成' }));
    const name = await canvas.findByRole('textbox', { name: 'スプリントの名前' });
    await expect(name).toHaveValue('スプリント 2');
    await expect(name).toHaveFocus();
    await expect(canvas.getByRole('button', { name: 'スプリントを作る' })).toBeEnabled();

    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(canvas.queryByRole('textbox', { name: 'スプリントの名前' })).toBeNull();
    });
    // 欄が消えてもフォーカスを body に落とさず、開く前のボタンへ戻す。
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: 'スプリントを作成' })).toHaveFocus();
    });
  },
};
