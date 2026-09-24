import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import KbBacklogPage from './KbBacklogPage';
import { routerWithParam, withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';

const workspaces = [{ slug: 'acme', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true }];
const projects = [
  { id: 'p-1', workspaceId: 'w-1', key: 'frestyle', name: 'frestyle', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' },
];

const status = (over: Record<string, unknown>) => ({
  id: 'st-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  name: 'To Do',
  category: 'todo',
  color: '#5b6b7a',
  position: 'a0',
  isInitial: true,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  activeTicketCount: 1,
  ...over,
});

const type = (over: Record<string, unknown>) => ({
  id: 'ty-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  name: '開発タスク',
  hierarchyLevel: 0,
  color: '#2563eb',
  position: 'a0',
  isDefault: true,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-08T00:00:00Z',
  activeTicketCount: 1,
  ...over,
});

const ticket = (over: Record<string, unknown>) => ({
  id: 't-1',
  workspaceId: 'w-1',
  projectId: 'p-1',
  number: 457,
  typeId: 'ty-1',
  statusId: 'st-1',
  title: '段1: チケットの骨格（9表）',
  doc: { type: 'doc', content: [] },
  priority: 1,
  position: 'a0',
  createdByUserId: 1,
  createdAt: '2026-09-08T00:00:00Z',
  updatedAt: '2026-09-09T00:00:00Z',
  ...over,
});

function baseApi(over: ApiStubs = {}): ApiStubs {
  return {
    '/workspaces/acme/projects/p-1/ticket-statuses': { statuses: [status({})] },
    '/workspaces/acme/projects/p-1/ticket-types': { types: [type({})] },
    '/workspaces/acme/labels': { labels: [] },
    // 宛先は「先に登録した鍵の部分一致」で決まる。`…/tickets` は `…/tickets/counts` にも一致するので、
    // 長い方を先に置く。
    '/workspaces/acme/projects/p-1/tickets/counts': { total: 1, assignedToMe: 0, overdue: 1, unassigned: 1 },
    '/workspaces/acme/projects/p-1/tickets': { tickets: [ticket({})] },
    '/workspaces/acme/projects/p-1/saved-filters': { savedFilters: [] },
    '/workspaces/acme/projects': { projects },
    '/kb/workspaces': workspaces,
    ...over,
  };
}

const meta = {
  title: 'pages/backlog/KbBacklogPage',
  component: KbBacklogPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast, routerWithParam('/backlog/:projectId', '/backlog/p-1')],
} satisfies Meta<typeof KbBacklogPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ふつう: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    });
  },
};

export const 狭い画面: Story = {
  decorators: [withApi(baseApi())],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

export const アーカイブが空: Story = {
  decorators: [withApi(baseApi({ '/workspaces/acme/projects/p-1/tickets': { tickets: [] } }))],
  args: { view: 'archive' },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('heading', { name: 'アーカイブされたチケットはありません' })).toBeVisible();
  },
};

export const 設定の取得失敗を未有効化と取り違えない: Story = {
  decorators: [withApi(baseApi({ '/workspaces/acme/projects/p-1/ticket-statuses': () => { throw new Error('offline'); } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'チケットの設定を読み込めませんでした' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '再読み込み' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'チケットを有効化' })).toBeNull();
  },
};

export const 未有効化: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/projects/p-1/ticket-statuses': { statuses: [] },
        '/workspaces/acme/projects/p-1/ticket-types': { types: [] },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(
        within(canvasElement).getByText('このプロジェクトではチケットを使っていません'),
      ).toBeInTheDocument();
    });
  },
};

/**
 * 面の切替は本文のタブ列が持ち、1 つずつが固有の経路を持つ（見本と同じ）。
 * リンクなので中クリックで別タブにも開ける。
 */
export const 面のタブは経路を持つ: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    });
    const settings = canvas.getByRole('link', { name: '設定' });
    await expect(settings).toHaveAttribute('href', '/backlog/p-1/settings');
    await expect(canvas.getByRole('link', { name: 'アーカイブ' })).toHaveAttribute(
      'href',
      '/backlog/p-1/archive',
    );
    // いま見ている面が分かる。
    await expect(canvas.getByRole('link', { name: 'バックログ' })).toHaveAttribute('aria-current', 'page');
  },
};

/** 見出しの塊。プロジェクトの行 → 面の名前 → 一文 → 保存した絞り込みのタブ → 操作列（設計ボード ST08）。 */
export const 見出しと絞り込みタブ: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { level: 1, name: 'バックログ' })).toBeInTheDocument();
    });
    await expect(canvas.getByText('プロジェクト FRESTYLE')).toBeInTheDocument();
    await expect(canvas.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: /期限切れ/ })).toHaveTextContent('1');
    });
    // 課題をつくる は操作列に。見出しの塊には無い。
    await expect(canvas.getByRole('button', { name: '課題をつくる' })).toBeInTheDocument();
  },
};

const savedFilter = (over: Record<string, unknown>) => ({
  id: 'f-1',
  name: '自分の不具合',
  labelId: 'l-1',
  assignedToMe: true,
  unassigned: false,
  overdue: false,
  count: 1,
  createdAt: '2026-09-24T00:00:00Z',
  updatedAt: '2026-09-24T00:00:00Z',
  ...over,
});

const label = { id: 'l-1', name: '不具合', color: '#b3392c', createdAt: '', updatedAt: '' };

/**
 * 利用者が保存した絞り込みは固定の 4 つの後ろに並ぶ（設計ボード ST09）。押すと条件が URL に
 * 書き出され、そのタブだけが押された表示になる（同じ「自分の担当」を含んでいても、固定のタブは
 * 押されない）。条件はチップにも出る。
 */
export const 保存した絞り込みが並ぶ: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/labels': { labels: [label] },
        '/workspaces/acme/projects/p-1/saved-filters': {
          savedFilters: [savedFilter({}), savedFilter({ id: 'f-2', name: '期限切れの検索', labelId: undefined, assignedToMe: false, overdue: true, q: '検索', count: 0 })],
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const mine = await canvas.findByRole('button', { name: /^自分の不具合(?! の操作)/ });
    await expect(mine).toHaveTextContent('1');
    await expect(canvas.getByRole('button', { name: /^期限切れの検索(?! の操作)/ })).toHaveTextContent('0');
    await userEvent.click(mine);
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: /^自分の不具合(?! の操作)/ })).toHaveAttribute('aria-pressed', 'true');
    });
    await expect(canvas.getByRole('button', { name: /^自分の担当/ })).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'false');
    await expect(canvas.getByRole('button', { name: 'ラベル: 不具合 の絞り込みを解除' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '担当: 自分 の絞り込みを解除' })).toBeVisible();
    // 条件を手で変えると選択は外れる（保存したものと違う条件を同じ名前で見せない）。
    await userEvent.click(canvas.getByRole('button', { name: 'ラベル: 不具合 の絞り込みを解除' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: /^自分の不具合(?! の操作)/ })).toHaveAttribute('aria-pressed', 'false');
    });
  },
};

/**
 * 条件を付けると一覧の下の右端に「この絞り込みを保存 ＋」が出る（ST09）。名前を付けて保存すると
 * 新しいタブが押された状態で増え、結果は操作した場所（タブの並びの下）に出る。
 */
export const この絞り込みを保存: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/projects/p-1/saved-filters': (config: { method?: string }) =>
          config.method === 'post'
            ? savedFilter({ id: 'f-new', name: '期限切れだけ', labelId: undefined, assignedToMe: false, overdue: true, count: 1 })
            : { savedFilters: [] },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('FRESTYLE-457');
    // 条件が無い間は保存する物が無い。
    await expect(canvas.queryByRole('button', { name: 'この絞り込みを保存' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: /期限切れ/ }));
    await userEvent.click(await canvas.findByRole('button', { name: 'この絞り込みを保存' }));
    const name = await canvas.findByRole('textbox', { name: '絞り込みの名前' });
    await expect(name).toHaveFocus();
    await userEvent.type(name, '期限切れだけ');
    await userEvent.click(canvas.getByRole('button', { name: '保存する' }));
    await expect(await canvas.findByText('絞り込み「期限切れだけ」を保存しました')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /^期限切れだけ(?! の操作)/ })).toHaveAttribute('aria-pressed', 'true');
    // 保存済みのタブを選んでいる間は、同じ条件をもう 1 つ作らせない。
    await expect(canvas.queryByRole('button', { name: 'この絞り込みを保存' })).toBeNull();
  },
};

/** 件数が取れなかったら、0 と取り違えないよう数字の代わりに「—」を出す。タブは押せる。 */
export const 件数が取れないときは数字を出さない: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/projects/p-1/tickets/counts': () => {
          throw new Error('offline');
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('FRESTYLE-457');
    await waitFor(async () => {
      await expect(within(canvas.getByRole('button', { name: /自分の担当/ })).getByLabelText('件数を取得できませんでした')).toBeVisible();
    });
  },
};

/** 担当はフィルターの選択欄からも絞れる。固定のタブ「自分の担当」と同じ条件になり、同じチップが出る。 */
export const 担当で絞る: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('FRESTYLE-457');
    await userEvent.click(canvas.getByRole('button', { name: 'フィルター' }));
    await userEvent.click(canvas.getByLabelText('担当で絞り込む'));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: '自分' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: '担当: 自分 の絞り込みを解除' })).toBeVisible();
    });
    await expect(canvas.getByRole('button', { name: /^自分の担当/ })).toHaveAttribute('aria-pressed', 'true');
  },
};

/** 「フィルター」を押すと選択欄が現れ、条件を選ぶと URL とチップに載る。 */
export const フィルターを開いて条件を付ける: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole('button', { name: 'フィルター' }));
    await userEvent.click(canvas.getByLabelText('状態で絞り込む'));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole('option', { name: 'To Do' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: '状態: To Do の絞り込みを解除' })).toBeVisible();
    });
    await expect(canvas.getByLabelText('1 件の条件を適用中')).toBeInTheDocument();
  },
};

/** 設定の面。状態・種別・スプリントの管理をここに集める。 */
/**
 * スプリントの削除は確認を挟む（中のチケットはバックログへ戻り、スプリントは元に戻せない）。
 * 取り消せば何も起きない。
 *
 * スタブの宛先は前から順の部分一致なので、スプリントの鍵は `/workspaces/acme/projects` より先に置く。
 */
export const スプリントの削除は確認してから: Story = {
  decorators: [
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
  render: () => <KbBacklogPage view="settings" />,
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

/** スプリント 1 本を持つスタブ。鍵は `/workspaces/acme/projects` より先に置く（前から順の部分一致）。 */
function sprintApi(): ApiStubs {
  return {
    '/workspaces/acme/projects/p-1/sprints': {
      sprints: [
        {
          id: 's-1',
          workspaceId: 'w-1',
          projectId: 'p-1',
          name: 'スプリント 1',
          state: 'planned',
          startDate: '2026-09-01',
          endDate: '2026-09-14',
          position: 'a0',
          ticketCount: 0,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        },
      ],
    },
    '/workspaces/acme/sprints/s-1/tickets': { ticketIds: [] },
    ...baseApi(),
  };
}

/**
 * バックログの段からは名前を聞かずに連番で作る（Jira のバックログと同じ）。作ったことと、
 * 名前を変えられる場所を知らせる。
 */
export const バックログからはすぐスプリントを作る: Story = {
  decorators: [withApi(sprintApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'スプリントを作成' }));
    await waitFor(async () => {
      await expect(screen.getByText('「スプリント 2」を作りました。名前は「設定」で変えられます。')).toBeInTheDocument();
    });
  },
};

/** 設定の面では名前の欄を開く。連番を入れておき、Esc で欄だけを閉じて作成ボタンへ戻る。 */
export const 設定ではスプリントの名前を決めて作る: Story = {
  decorators: [withApi(sprintApi())],
  render: () => <KbBacklogPage view="settings" />,
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

export const 設定の面: Story = {
  // 面は経路ではなく prop で決まる（経路 → prop の対応は app/App.tsx が持つ）。
  // ここで router を重ねると入れ子になるので、meta の router のまま prop だけ変える。
  decorators: [withApi(baseApi())],
  render: () => <KbBacklogPage view="settings" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      // 状態と種別の管理はどちらも色を選ぶ口を持つので、件数で見る（一覧には 1 つも無い）。
      await expect(canvas.getAllByLabelText('色')).toHaveLength(2);
    });
    // スプリントの改名・期間・削除もこの面。バックログの面には置かない。
    await expect(canvas.getByRole('button', { name: 'スプリントを作成' })).toBeInTheDocument();
  },
};
