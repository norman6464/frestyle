import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import HomeCreateDialog from './HomeCreateDialog';
import { withApi, type ApiStubs } from '../../../../.storybook/decorators';

const workspaces = [
  { slug: 'frestyle', name: 'frestyle', createdAt: '', canManage: true, canCreateTickets: true },
  { slug: 'devsync', name: 'devsync', createdAt: '', canManage: false, canCreateTickets: true },
  { slug: 'readonly', name: '閲覧だけ', createdAt: '', canManage: false, canCreateTickets: false },
];

const createPage = fn();
const createFromTemplate = fn();
const createTicket = fn();

function body(config: { data?: unknown }): Record<string, unknown> {
  return typeof config.data === 'string' ? (JSON.parse(config.data) as Record<string, unknown>) : {};
}

const ticketStatus = (projectId: string, isInitial: boolean) => ({
  id: `st-${projectId}`, workspaceId: 'w', projectId, name: 'To Do', category: 'todo', color: '#66655f',
  position: 'a0', isInitial, archivedAt: null, createdAt: '', updatedAt: '',
});

/** 細かい宛先を先に書く（`/workspaces/frestyle/projects` が先だと、作成や状態の問い合わせにも一覧が返る）。 */
function api(over: ApiStubs = {}): ApiStubs {
  return {
    '/spaces/s-product/pages/from-template': (config: { data?: unknown }) => {
      createFromTemplate(body(config));
      return { id: 'page-from-template', spaceId: 's-product', title: 'x', position: 'a0' };
    },
    '/spaces/s-product/pages': (config: { data?: unknown }) => {
      createPage(body(config));
      return { id: 'page-new', spaceId: 's-product', title: 'x', position: 'a0' };
    },
    '/kb/workspaces/frestyle/me/spaces': [
      { id: 's-product', name: 'プロダクト開発', role: 'editor' },
      { id: 's-team', name: 'チームノート', role: 'admin' },
      { id: 's-readonly', name: '経営会議', role: 'viewer' },
    ],
    '/kb/workspaces/devsync/me/spaces': [{ id: 's-guide', name: '開発ガイド', role: 'editor' }],
    '/kb/workspaces/frestyle/templates': [
      { id: 'tpl-minutes', name: '議事録', spaceId: null, createdAt: '' },
      { id: 'tpl-design', name: '設計メモ', spaceId: 's-product', createdAt: '' },
      { id: 'tpl-other', name: 'ほかのスペースのひな形', spaceId: 's-team', createdAt: '' },
    ],
    '/kb/workspaces/devsync/templates': [],
    '/projects/p-product/ticket-statuses': { statuses: [ticketStatus('p-product', true)] },
    '/projects/p-web/ticket-statuses': { statuses: [ticketStatus('p-web', true)] },
    '/projects/p-product/tickets': (config: { data?: unknown }) => {
      createTicket(body(config));
      return {
        id: 'ticket-new', workspaceId: 'w', projectId: 'p-product', number: 152, typeId: 't', statusId: 's',
        title: 'x', doc: null, priority: 2, createdByUserId: 1, createdAt: '', updatedAt: '',
      };
    },
    '/workspaces/frestyle/projects': { projects: [{ id: 'p-product', workspaceId: 'w', key: 'FRE', name: 'Product', createdAt: '', updatedAt: '' }] },
    '/workspaces/devsync/projects': { projects: [{ id: 'p-web', workspaceId: 'w', key: 'DEV', name: 'Website', createdAt: '', updatedAt: '' }] },
    ...over,
  };
}

/**
 * 作った後に移った先を読むための表示（ダイアログは画面の遷移では消えないので、場所で確かめる）。
 * ダイアログの外にあり、開いている間は読み上げの木から外れるので、読むときは hidden も含める。
 */
function LocationProbe() {
  const location = useLocation();
  return <output aria-label="いまの場所">{location.pathname}</output>;
}

const meta = {
  title: 'pages/home/HomeCreateDialog',
  component: HomeCreateDialog,
  parameters: { layout: 'fullscreen' },
  args: { workspaces, initialWorkspaceSlug: 'frestyle', onClose: fn() },
  beforeEach: () => {
    createPage.mockClear();
    createFromTemplate.mockClear();
    createTicket.mockClear();
  },
  decorators: [
    (Story) => (
      <MemoryRouter>
        <LocationProbe />
        <Story />
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof HomeCreateDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const body$ = () => within(document.body);

/**
 * ページをつくる（DB03 の左）。保存先は作れるスペースだけ、はじめ方はこの場所で使えるテンプレートだけ。
 * 作成先を見せてから作り、作れたらそのページを開く。
 */
export const ページをつくる: Story = {
  decorators: [withApi(api())],
  play: async () => {
    const dialog = await body$().findByRole('dialog', { name: '新しくつくる' });
    const d = within(dialog);
    await expect(d.getByRole('tab', { name: 'ページ' })).toHaveAttribute('aria-selected', 'true');
    await expect(d.getByRole('combobox', { name: 'ワークスペース' })).toHaveValue('frestyle');
    const space = await d.findByRole('combobox', { name: '保存先のスペース' });
    const spaceOptions = within(space).getAllByRole('option').map((o) => o.textContent);
    await expect(spaceOptions).toEqual(['プロダクト開発', 'チームノート']);
    const template = d.getByRole('combobox', { name: 'はじめ方' });
    await waitFor(async () => {
      await expect(within(template).getAllByRole('option').map((o) => o.textContent)).toEqual(['空のページ', '議事録', '設計メモ']);
    });
    await expect(d.getByText('frestyle / プロダクト開発')).toBeVisible();

    await userEvent.type(d.getByRole('textbox', { name: 'ページのタイトル' }), 'オンボーディングの進め方');
    await userEvent.click(d.getByRole('button', { name: /ページを作成してひらく/ }));
    await waitFor(async () => {
      await expect(body$().getByRole('status', { name: 'いまの場所', hidden: true })).toHaveTextContent('/kb/page-new');
    });
    await expect(createPage).toHaveBeenCalledTimes(1);
    await expect(createPage).toHaveBeenCalledWith(expect.objectContaining({ title: 'オンボーディングの進め方' }));
  },
};

/** テンプレートを選ぶと、テンプレートから作る口を使う。 */
export const テンプレートからつくる: Story = {
  decorators: [withApi(api())],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    const template = await d.findByRole('combobox', { name: 'はじめ方' });
    await waitFor(async () => {
      await expect(template).toBeEnabled();
    });
    await userEvent.selectOptions(template, '議事録');
    await userEvent.type(d.getByRole('textbox', { name: 'ページのタイトル' }), '9月の定例');
    await userEvent.click(d.getByRole('button', { name: /ページを作成してひらく/ }));
    await waitFor(async () => {
      await expect(createFromTemplate).toHaveBeenCalledWith({ templateId: 'tpl-minutes', title: '9月の定例' });
    });
    await expect(createPage).not.toHaveBeenCalled();
  },
};

/** ワークスペースを替えると、それに依る選択（スペース・テンプレート）は選び直しになる。 */
export const ワークスペースを替えると選び直す: Story = {
  decorators: [withApi(api())],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    await d.findByRole('combobox', { name: '保存先のスペース' });
    await userEvent.selectOptions(d.getByRole('combobox', { name: 'ワークスペース' }), 'devsync');
    await waitFor(async () => {
      await expect(d.getByRole('combobox', { name: '保存先のスペース' })).toHaveValue('s-guide');
    });
    await expect(d.getByRole('combobox', { name: 'はじめ方' })).toHaveValue('');
    await expect(d.getByText('devsync / 開発ガイド')).toBeVisible();
  },
};

/** タイトルが空なら送らない。理由は欄のそばに出し、欄へ戻す。 */
export const タイトルが空: Story = {
  decorators: [withApi(api())],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    await d.findByRole('combobox', { name: '保存先のスペース' });
    await userEvent.click(d.getByRole('button', { name: /ページを作成してひらく/ }));
    const title = d.getByRole('textbox', { name: 'ページのタイトル' });
    await expect(title).toHaveAttribute('aria-invalid', 'true');
    await expect(title).toHaveAccessibleDescription('タイトルを入力してください。');
    await expect(title).toHaveFocus();
    await expect(createPage).not.toHaveBeenCalled();
  },
};

/**
 * チケットをつくる（DB03 の右）。チケットを作れるワークスペースだけを候補にし、プロジェクトの
 * 既定の種類・初期状態で作る。詳細は作ったあとのチケットで編集する。
 */
export const チケットをつくる: Story = {
  decorators: [withApi(api())],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    await userEvent.click(d.getByRole('tab', { name: 'チケット' }));
    const panel = within(d.getByRole('tabpanel', { name: 'チケット' }));
    const ws = panel.getByRole('combobox', { name: 'ワークスペース' });
    await expect(within(ws).getAllByRole('option').map((o) => o.textContent)).toEqual(['frestyle', 'devsync']);
    await expect(await panel.findByRole('combobox', { name: '所属するプロジェクト' })).toHaveValue('p-product');
    await expect(panel.getByText('詳細は作成したあとで')).toBeVisible();
    await expect(panel.getByText('frestyle / Product')).toBeVisible();

    await userEvent.type(panel.getByRole('textbox', { name: 'チケットのタイトル' }), '初参加の手順を動作確認する');
    const submit = panel.getByRole('button', { name: /チケットを作成してひらく/ });
    await waitFor(async () => {
      await expect(submit).toBeEnabled();
    });
    await userEvent.click(submit);
    await waitFor(async () => {
      await expect(body$().getByRole('status', { name: 'いまの場所', hidden: true })).toHaveTextContent('/tickets/ticket-new');
    });
    await expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ title: '初参加の手順を動作確認する' }));
  },
};

/** 見られるだけのスペースしか無いワークスペース。作れない理由を言い、作成ボタンは押せない。 */
export const ページを作れるスペースが無い: Story = {
  decorators: [
    withApi(api({ '/kb/workspaces/frestyle/me/spaces': [{ id: 's-readonly', name: '経営会議', role: 'viewer' }] })),
  ],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    await expect(await d.findByText(/ページを作れるスペースがありません/)).toBeVisible();
    await expect(d.getByRole('link', { name: /ナレッジでスペースを作成/ })).toHaveAttribute('href', '/kb');
    await expect(d.getByRole('button', { name: /ページを作成してひらく/ })).toBeDisabled();
  },
};

/** プロジェクトはあるが、まだチケットを使える状態でない。権限不足とは分けて言う。 */
export const プロジェクトが未設定: Story = {
  decorators: [withApi(api({ '/projects/p-product/ticket-statuses': { statuses: [] } }))],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    await userEvent.click(d.getByRole('tab', { name: 'チケット' }));
    const panel = within(d.getByRole('tabpanel', { name: 'チケット' }));
    await expect(await panel.findByText(/まだチケットを使える状態になっていません/)).toBeVisible();
    await expect(panel.getByRole('link', { name: /バックログで有効にする/ })).toHaveAttribute('href', '/backlog/p-product');
    await expect(panel.getByRole('button', { name: /チケットを作成してひらく/ })).toBeDisabled();
  },
};

/** どのワークスペースでもチケットを作れない（閲覧だけ）。 */
export const チケットを作れる場所が無い: Story = {
  args: { workspaces: [workspaces[2]], initialWorkspaceSlug: 'readonly' },
  decorators: [withApi(api({ '/kb/workspaces/readonly/me/spaces': [], '/kb/workspaces/readonly/templates': [] }))],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    await userEvent.click(d.getByRole('tab', { name: 'チケット' }));
    await expect(await d.findByText(/チケットを作れるワークスペースがありません/)).toBeVisible();
  },
};

/** 応答が無く、作れたか分からない。言い切らず、自動では送り直さない。 */
export const 作れたか分からない: Story = {
  decorators: [
    withApi(
      api({
        '/spaces/s-product/pages': () => {
          createPage();
          throw new Error('network');
        },
      }),
    ),
  ],
  play: async () => {
    const d = within(await body$().findByRole('dialog', { name: '新しくつくる' }));
    await d.findByRole('combobox', { name: '保存先のスペース' });
    await userEvent.type(d.getByRole('textbox', { name: 'ページのタイトル' }), '週報');
    await userEvent.click(d.getByRole('button', { name: /ページを作成してひらく/ }));
    await expect(await d.findByRole('alert')).toHaveTextContent('作成できたか確認できません');
    await expect(createPage).toHaveBeenCalledTimes(1);
    await expect(d.getByRole('button', { name: /ページを作成してひらく/ })).toBeEnabled();
    await expect(body$().getByRole('status', { name: 'いまの場所', hidden: true })).toHaveTextContent('/');
  },
};

export const 狭い画面: Story = {
  decorators: [withApi(api())],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
