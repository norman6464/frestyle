import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import BacklogTicketsPage from './BacklogTicketsPage';
import { backlogRoute, withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';
import { baseApi, projects, sprintApi, ticket } from './__fixtures__/backlogApi';

/**
 * 本番と同じくバックログの親ルートの中に置く。親ルートがプロジェクトを取りに行くので、経路は
 * API の見本より内側（decorators の配列の先頭）に置く（先に書いたものほど内側になる）。
 */
const route = backlogRoute('/backlog/:projectId', '/backlog/p-1');

const meta = {
  title: 'pages/backlog/BacklogTicketsPage',
  component: BacklogTicketsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast],
} satisfies Meta<typeof BacklogTicketsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ふつう: Story = {
  decorators: [route, withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('FRESTYLE-457')).toBeInTheDocument();
    });
  },
};

export const 狭い画面: Story = {
  decorators: [route, withApi(baseApi())],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

export const アーカイブが空: Story = {
  decorators: [route, withApi(baseApi({ '/workspaces/acme/projects/p-1/tickets': { tickets: [] } }))],
  args: { archived: true },
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('heading', { name: 'アーカイブされたチケットはありません' })).toBeVisible();
  },
};

/** URL のプロジェクトが見つからない。行き止まりにせず、バックログの入口へ戻れる。 */
export const プロジェクトが見つからない: Story = {
  decorators: [route, withApi(baseApi({ '/workspaces/acme/projects': { projects: [] } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'このプロジェクトは見つかりませんでした' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'バックログへ戻る' })).toBeVisible();
    await expect(canvas.queryByRole('alert')).toBeNull();
  },
};

/** プロジェクトを読み込めなかった。「見つからない」とは言わず、取り直せる。 */
export const プロジェクトを読み込めない: Story = {
  decorators: [
    route,
    withApi(
      baseApi({
        // 親ルートは所在の口でプロジェクトのワークスペースを引く。最初の 1 回だけ届かない。
        '/api/v2/projects/p-1': (() => {
          let calls = 0;
          return () => {
            calls += 1;
            if (calls === 1) throw new Error('offline');
            return { workspaceSlug: 'acme', workspaceName: '開発チーム', project: projects[0] };
          };
        })(),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('alert')).toHaveTextContent('バックログを読み込めませんでした。');
    await expect(canvas.queryByRole('heading', { name: 'このプロジェクトは見つかりませんでした' })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: '再試行' }));
    await expect(await canvas.findByText('段1: チケットの骨格（9表）')).toBeVisible();
  },
};

export const 設定の取得失敗を未有効化と取り違えない: Story = {
  decorators: [route, withApi(baseApi({ '/workspaces/acme/projects/p-1/ticket-statuses': () => { throw new Error('offline'); } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'チケットの設定を読み込めませんでした' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '再読み込み' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'チケットを有効化' })).toBeNull();
  },
};

export const 未有効化: Story = {
  decorators: [
    route,
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
  decorators: [route, withApi(baseApi())],
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
  decorators: [route, withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { level: 1, name: 'バックログ' })).toBeInTheDocument();
    });
    await expect(canvas.getByText('プロジェクト FRESTYLE')).toBeInTheDocument();
    // 絞り込みのタブは状態・種別を読み終えてから出る（見出しはプロジェクトが分かった時点で先に出る）。
    await expect(await canvas.findByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
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
    route,
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
    route,
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
    route,
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
  decorators: [route, withApi(baseApi())],
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

const TITLE = '段1: チケットの骨格（9表）';

/** 題名は独立したチケット画面へのリンク。表の行全体をリンクで包まず、操作と分ける。 */
export const 題名からチケットを開く: Story = {
  decorators: [route, withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('link', { name: TITLE })).toHaveAttribute('href', '/tickets/t-1');
    await expect(canvas.getByRole('table', { name: 'チケット' })).toHaveAttribute('data-layout', 'table');
  },
};

/** 行の「…」は並び替えを開く。題名への移動とは別の操作として使える。 */
export const 行の操作を開く: Story = {
  decorators: [route, withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: `${TITLE} の操作` }));
    await expect(await screen.findByRole('menuitem', { name: '1 つ上へ' })).toBeInTheDocument();
    await expect(canvas.getByRole('link', { name: TITLE })).toHaveAttribute('href', '/tickets/t-1');
  },
};

/** 狭い画面では一覧がカードになる。題名から同じチケット画面へ進む。 */
export const 狭い画面のチケットリンク: Story = {
  decorators: [route, withApi(baseApi())],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('table', { name: 'チケット' })).toHaveAttribute('data-layout', 'card');
    });
    await expect(canvas.getByRole('link', { name: TITLE })).toHaveAttribute('href', '/tickets/t-1');
  },
};

/** 「フィルター」を押すと選択欄が現れ、条件を選ぶと URL とチップに載る。 */
export const フィルターを開いて条件を付ける: Story = {
  decorators: [route, withApi(baseApi())],
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

/**
 * スプリントの中身（どのチケットがどの順で入っているか）を覚えて返すスタブ。入れる・出す・並べ替えの
 * 書き込みを受けたら中身を変える（サーバーと同じく、書き込みのあとに取り直せば新しい並びが返る）。
 * 鍵は `/workspaces/acme/projects` より先に置く（前から順の部分一致）。
 */
function statefulSprintApi(initial: string[], tickets: ReturnType<typeof ticket>[]): ApiStubs {
  let members = [...initial];
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
          ticketCount: initial.length,
          createdAt: '2026-09-01T00:00:00Z',
          updatedAt: '2026-09-01T00:00:00Z',
        },
      ],
    },
    '/workspaces/acme/sprints/s-1/tickets': (config: { method?: string; data?: unknown }) => {
      if (config.method === 'post') {
        const { ticketId } = JSON.parse(String(config.data)) as { ticketId: string };
        members = [...members.filter((id) => id !== ticketId), ticketId];
        return undefined;
      }
      return { ticketIds: members };
    },
    // スプリント内の並べ替え（…/tickets/:id/sprint/position）。行の手前・直後、または末尾へ置く。
    '/sprint/position': (config: { url?: string; data?: unknown }) => {
      const ticketId = /tickets\/([^/]+)\/sprint/.exec(config.url ?? '')?.[1] ?? '';
      const { anchorTicketId, anchorAfter } = JSON.parse(String(config.data)) as {
        anchorTicketId: string;
        anchorAfter: boolean;
      };
      const rest = members.filter((id) => id !== ticketId);
      const at = rest.indexOf(anchorTicketId);
      members = at === -1 ? [...rest, ticketId] : [...rest.slice(0, at + (anchorAfter ? 1 : 0)), ticketId, ...rest.slice(at + (anchorAfter ? 1 : 0))];
      return undefined;
    },
    '/workspaces/acme/projects/p-1/tickets': { tickets },
    ...baseApi({ '/workspaces/acme/projects/p-1/tickets': { tickets } }),
  };
}

/** スプリントの段の中の行の題名を、上から順に読む（段の見出しの行は数えない）。 */
function sprintRowTitles(canvasElement: HTMLElement): string[] {
  const groups = within(canvasElement).getAllByRole('rowgroup');
  const sprintGroup = groups.find((group) => group.textContent?.includes('スプリント 1'));
  if (!sprintGroup) return [];
  return within(sprintGroup)
    .queryAllByRole('link', { name: /^段/ })
    .map((link) => link.textContent ?? '');
}

/** 行の「…」からスプリントへ入れると、その場でスプリントの段へ移る。 */
export const スプリントへ入れるとその段へ移る: Story = {
  decorators: [route, withApi(statefulSprintApi([], [ticket({})]))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: `${TITLE} の操作` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'スプリント 1 へ入れる' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: /スプリント 1.*1 件/ })).toBeInTheDocument();
    });
    await expect(sprintRowTitles(canvasElement)).toEqual([TITLE]);
  },
};

/** スプリントの中で「末尾へ」と並べ替えると、段の中の順がその場で変わる。 */
export const スプリントの中で並べ替えると順が変わる: Story = {
  decorators: [
    route,
    withApi(
      statefulSprintApi(
        ['t-1', 't-2'],
        [ticket({}), ticket({ id: 't-2', number: 458, title: '段2: 並べ替え', position: 'a1' })],
      ),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(sprintRowTitles(canvasElement)).toEqual([TITLE, '段2: 並べ替え']);
    });
    await userEvent.click(canvas.getByRole('button', { name: `${TITLE} の操作` }));
    await userEvent.click(await screen.findByRole('menuitem', { name: '末尾へ' }));
    await waitFor(async () => {
      await expect(sprintRowTitles(canvasElement)).toEqual(['段2: 並べ替え', TITLE]);
    });
  },
};

/**
 * バックログの段からは名前を聞かずに連番で作る（Jira のバックログと同じ）。作ったことと、
 * 名前を変えられる場所を知らせる。
 */
export const バックログからはすぐスプリントを作る: Story = {
  decorators: [route, withApi(sprintApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'スプリントを作成' }));
    await waitFor(async () => {
      await expect(screen.getByText('「スプリント 2」を作りました。名前は「設定」で変えられます。')).toBeInTheDocument();
    });
  },
};
