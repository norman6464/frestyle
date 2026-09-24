import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import HomePage from './HomePage';
import { withApi, withRouter, type ApiStubs } from '../../../../.storybook/decorators';

/** 見本の日付を今日からの相対で作る（期限が過ぎた扱いにならないように）。 */
function daysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

const workspaces = [
  { slug: 'frestyle', name: 'frestyle', createdAt: '', canManage: true, canCreateTickets: true },
  { slug: 'devsync', name: 'devsync', createdAt: '', canManage: false, canCreateTickets: true },
];

const recentPages = [
  { pageId: 'page-onboarding', workspaceSlug: 'frestyle', title: 'オンボーディングの進め方', spaceId: 's1', spaceName: 'プロダクト開発', viewedAt: hoursAgo(2) },
  { pageId: 'page-release', workspaceSlug: 'devsync', title: 'リリース前の確認事項', spaceId: 's2', spaceName: '開発ガイド', viewedAt: hoursAgo(20) },
  { pageId: 'page-retro', workspaceSlug: 'frestyle', title: '9月のふりかえり', spaceId: 's3', spaceName: 'チームノート', viewedAt: hoursAgo(26) },
  { pageId: 'page-spec', workspaceSlug: 'frestyle', title: '仕様レビューの進め方', spaceId: 's4', spaceName: '開発ガイド', viewedAt: hoursAgo(50) },
];

const references = [
  { id: 'ticket-invite', projectKey: 'FRE', number: 143, title: '招待フローの案内文を確認する' },
  { id: 'ticket-first', projectKey: 'FRE', number: 151, title: '初参加の手順を動作確認する' },
];

const assigned = [
  { id: 'ticket-invite', workspaceSlug: 'frestyle', workspaceName: 'frestyle', projectId: 'p1', projectKey: 'FRE', projectName: 'Product', number: 143, title: '招待フローの案内文を確認する', typeName: 'タスク', statusName: '進行中', statusCategory: 'in_progress', statusColor: '#2563eb', priority: 2, dueDate: daysFromToday(2) },
  { id: 'ticket-release', workspaceSlug: 'devsync', workspaceName: 'devsync', projectId: 'p2', projectKey: 'DEV', projectName: 'Website', number: 52, title: 'リリース手順の確認項目を整理する', typeName: 'タスク', statusName: '未着手', statusCategory: 'todo', statusColor: '#66655f', priority: 2, dueDate: daysFromToday(4) },
  { id: 'ticket-guide', workspaceSlug: 'frestyle', workspaceName: 'frestyle', projectId: 'p1', projectKey: 'FRE', projectName: 'Product', number: 150, title: '共有ページの操作ガイドを見直す', typeName: 'タスク', statusName: '未着手', statusCategory: 'todo', statusColor: '#66655f', priority: 2, dueDate: null },
];

const favorites = [
  { pageId: 'fav-1', title: 'プロダクトの判断基準', spaceId: 's1', spaceName: 'プロダクト開発', createdAt: '' },
  { pageId: 'fav-2', title: 'チームの働き方', spaceId: 's3', spaceName: 'チームノート', createdAt: '' },
  { pageId: 'fav-3', title: '仕様レビューの進め方', spaceId: 's4', spaceName: '開発ガイド', createdAt: '' },
  { pageId: 'fav-4', title: '用語集', spaceId: 's4', spaceName: '開発ガイド', createdAt: '' },
];

/**
 * 見本の通信。細かい宛先を先に書く（`/kb/workspaces` が先だと、お気に入りや逆参照・検索の問い合わせ
 * にもワークスペース一覧が返ってしまう）。上書きしても並びは元の位置のまま。
 */
function api(over: ApiStubs = {}): ApiStubs {
  const base: ApiStubs = {
    '/ticket-backlinks': { tickets: references },
    '/search': [],
    '/kb/workspaces/frestyle/favorites': favorites,
    '/kb/workspaces/devsync/favorites': [],
    '/kb/workspaces/frestyle/spaces': [],
    '/kb/workspaces/frestyle/me/spaces': [{ id: 's1', name: 'プロダクト開発', role: 'editor' }],
    '/kb/workspaces/frestyle/templates': [],
    '/kb/workspaces': workspaces,
    '/projects/p1/ticket-statuses': { statuses: [{ id: 'st', workspaceId: 'w', projectId: 'p1', name: 'To Do', category: 'todo', color: '#66655f', position: 'a0', isInitial: true, createdAt: '', updatedAt: '' }] },
    '/workspaces/frestyle/projects': { projects: [{ id: 'p1', workspaceId: 'w', key: 'FRE', name: 'Product', createdAt: '', updatedAt: '' }] },
    '/kb/me/recent-pages': recentPages,
    '/me/assigned-tickets': { tickets: assigned },
    '/notifications/unread-count': 3,
    '/profile/me': { userId: 7, displayName: '開発メンバー', avatarUrl: null, email: 'member@example.com' },
  };
  return { ...base, ...over };
}

/** 通信の失敗（応答が無い）。 */
function networkError(): never {
  throw new Error('network');
}

/** play の中で今の幅が広い画面か（CI の幅に依らず、どちらの形でも確かめられるように）。 */
const isWide = () => window.matchMedia('(min-width: 1024px)').matches;

/**
 * マイホーム（設計ボード DB01・DB02）。「知識を残し、その知識を使って仕事を進める」ための再開地点。
 * 主役は「続きからはじめる」、担当は補助。履歴と担当はワークスペース横断、お気に入りと
 * ページ検索は選んだワークスペースの中。所属 0 件は初回ホーム（ST07）。
 */
const meta = {
  title: 'pages/home/HomePage',
  component: HomePage,
  parameters: { layout: 'fullscreen' },
  // 端末に覚えたお気に入りの範囲を、前の見本から持ち越さない。
  beforeEach: () => {
    localStorage.removeItem('frestyle.home.favoritesWorkspace.7');
  },
  decorators: [
    withRouter,
    (Story) => (
      <div className="bg-surface">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof HomePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * いつものホーム（DB01）。最後に開いたページを大きなカードで、参照チケットを 2 行、残りの履歴を
 * 短い行で。担当は期限の近い順、未読は件数と入口だけ。
 */
export const いつものホーム: Story = {
  decorators: [withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const wide = isWide();
    await expect(canvas.getByRole('heading', { level: 1, name: 'マイホーム' })).toBeVisible();

    const card = await canvas.findByRole('article', { name: 'オンボーディングの進め方' });
    await expect(within(card).getByText('frestyle / プロダクト開発')).toBeVisible();
    await expect(within(card).getByRole('link', { name: /続きをひらく/ })).toHaveAttribute('href', '/kb/page-onboarding');

    // 参照チケット（狭い画面は畳んである）。
    if (!wide) await userEvent.click(within(card).getByRole('button', { name: 'このページを参照しているチケット' }));
    const refs = await within(card).findByRole('list', { name: 'このページを参照しているチケット' });
    await expect(within(refs).getAllByRole('link')).toHaveLength(2);
    await expect(within(refs).getByRole('link', { name: /招待フローの案内文を確認する/ })).toHaveAttribute(
      'href',
      '/tickets/ticket-invite',
    );

    const history = canvas.getByRole('list', { name: '最近開いたページ' });
    await expect(within(history).getAllByRole('listitem')).toHaveLength(wide ? 2 : 1);
    await expect(within(history).getByText('devsync / 開発ガイド')).toBeVisible();

    const mine = await canvas.findByRole('list', { name: '自分の担当' });
    await expect(within(mine).getAllByRole('listitem')).toHaveLength(wide ? 3 : 2);
    await expect(within(mine).getByText('FRE-143')).toBeVisible();
    await expect(within(mine).getAllByText('frestyle / Product')[0]).toBeVisible();
    await expect(canvas.getByText(wide ? '3件を表示' : '2件を表示')).toBeVisible();

    await expect(canvas.getByRole('link', { name: wide ? /通知一覧をひらく/ : /未読の通知 3件/ })).toHaveAttribute(
      'href',
      '/notifications',
    );
    const favoritesList = await canvas.findByRole('list', { name: 'お気に入りのページ' });
    await expect(within(favoritesList).getAllByRole('listitem')).toHaveLength(wide ? 3 : 2);
  },
};

/**
 * 「＋ 新しくつくる」でダイアログ（DB03）を開く。初めの保存先は、お気に入りで選んでいるワークスペース。
 * 閉じると押したボタンへ戻る。
 */
export const 新しくつくるを開く: Story = {
  decorators: [withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole('button', { name: '新しくつくる' });
    await userEvent.click(trigger);
    const dialog = await within(document.body).findByRole('dialog', { name: '新しくつくる' });
    await expect(within(dialog).getByRole('combobox', { name: 'ワークスペース' })).toHaveValue('frestyle');
    await expect(await within(dialog).findByText('frestyle / プロダクト開発')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: '閉じる' }));
    await waitFor(async () => {
      await expect(within(document.body).queryByRole('dialog')).toBeNull();
    });
    await waitFor(async () => {
      await expect(trigger).toHaveFocus();
    });
  },
};

/** 狭い画面（DB02）。未読 → 再開 → 担当 2 件 → お気に入り 2 件の 1 列。参照チケットは畳む。 */
export const 狭い画面: Story = {
  decorators: [withApi(api())],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};

/** 「履歴をひらく」「お気に入り一覧をひらく」はこの場で広げる（別の画面へ移らない）。 */
export const 履歴とお気に入りを広げる: Story = {
  decorators: [withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const history = await canvas.findByRole('list', { name: '最近開いたページ' });
    const historyToggle = canvas.getByRole('button', { name: /^履歴/ });
    await expect(historyToggle).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(historyToggle);
    await expect(historyToggle).toHaveAttribute('aria-expanded', 'true');
    await expect(within(history).getAllByRole('listitem')).toHaveLength(recentPages.length - 1);

    const favoritesList = await canvas.findByRole('list', { name: 'お気に入りのページ' });
    await userEvent.click(canvas.getByRole('button', { name: /お気に入り一覧をひらく/ }));
    await expect(within(favoritesList).getAllByRole('listitem')).toHaveLength(favorites.length);
    await expect(canvas.getByRole('button', { name: /お気に入り一覧を閉じる/ })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** お気に入りの範囲を切り替えると、お気に入りだけが変わる（履歴と担当は横断のまま）。 */
export const お気に入りのワークスペースを切り替える: Story = {
  decorators: [withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('list', { name: 'お気に入りのページ' });
    await userEvent.click(canvas.getByRole('combobox', { name: 'お気に入りを出すワークスペース' }));
    await userEvent.click(await within(document.body).findByRole('option', { name: 'devsync' }));
    await expect(await canvas.findByText('このワークスペースにお気に入りはありません')).toBeVisible();
    await expect(canvas.getByRole('button', { name: /devsync のページを検索/ })).toBeVisible();
    await expect(canvas.getByRole('list', { name: '自分の担当' })).toBeVisible();
  },
};

/** 選んだワークスペースのページ検索。検索窓を開き、閉じるとボタンへ戻る。 */
export const ワークスペースのページを検索: Story = {
  decorators: [withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole('button', { name: /frestyle のページを検索/ });
    await userEvent.click(trigger);
    const dialog = await within(document.body).findByRole('dialog');
    await expect(dialog).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(within(document.body).queryByRole('dialog')).toBeNull();
    });
  },
};

/** 履歴が 0 件（所属はある）。「ページを探す」を置き、担当とお気に入りはそのまま使える。 */
export const 履歴が0件: Story = {
  decorators: [withApi(api({ '/kb/me/recent-pages': [] }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('表示できる履歴はありません')).toBeVisible();
    await expect(canvas.getByRole('link', { name: /ページを探す/ })).toHaveAttribute('href', '/kb');
    await expect(await canvas.findByRole('list', { name: '自分の担当' })).toBeVisible();
  },
};

/** 担当が 0 件。初回案内に置き換えず、履歴とお気に入りを残す。 */
export const 担当が0件: Story = {
  decorators: [withApi(api({ '/me/assigned-tickets': { tickets: [] } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('未完了の担当はありません')).toBeVisible();
    await expect(await canvas.findByRole('article', { name: 'オンボーディングの進め方' })).toBeVisible();
  },
};

/**
 * 一部の枠だけ取得に失敗（担当・参照チケット・未読）。その枠だけに理由と再試行を出し、ほかの枠は
 * そのまま使える。0 件のふりをしない。
 */
export const 一部の取得に失敗: Story = {
  decorators: [
    withApi(
      api({
        '/me/assigned-tickets': networkError,
        '/ticket-backlinks': networkError,
        '/notifications/unread-count': networkError,
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('自分の担当を取得できませんでした。')).toBeVisible();
    await expect(canvas.queryByText('未完了の担当はありません')).toBeNull();
    await expect(await canvas.findByText('未読の通知の件数を取得できませんでした。')).toBeVisible();
    const card = await canvas.findByRole('article', { name: 'オンボーディングの進め方' });
    await expect(await within(card).findByText('このページを参照しているチケットを取得できませんでした。')).toBeVisible();
    await expect(within(card).getByRole('link', { name: /続きをひらく/ })).toBeVisible();
  },
};

/** 参照しているチケットが無ければ、節ごと出さない（空の飾りで埋めない）。 */
export const 参照チケットが無い: Story = {
  decorators: [withApi(api({ '/ticket-backlinks': { tickets: [] } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const card = await canvas.findByRole('article', { name: 'オンボーディングの進め方' });
    await waitFor(async () => {
      await expect(within(card).queryByText('このページを参照しているチケット')).toBeNull();
    });
  },
};

/** どこにも所属していない（ST07 の初回ホーム）。担当 0 件・履歴 0 件とは別の状態。 */
export const 所属が0件: Story = {
  decorators: [withApi(api({ '/kb/workspaces': [], '/kb/me/recent-pages': [], '/me/assigned-tickets': { tickets: [] } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { level: 1, name: 'FreStyle へようこそ。' })).toBeVisible();
    await expect(canvas.getByRole('link', { name: /ナレッジをひらく/ })).toHaveAttribute('href', '/kb');
    await expect(canvas.getByRole('link', { name: /バックログをひらく/ })).toHaveAttribute('href', '/backlog');
    await expect(canvas.getByRole('link', { name: /あなたへの招待を確認/ })).toHaveAttribute('href', '/invitations');
    await expect(canvas.queryByRole('heading', { name: 'マイホーム' })).toBeNull();
  },
};

/** 初回ホームの狭い画面。 */
export const 所属が0件_狭い画面: Story = {
  decorators: [withApi(api({ '/kb/workspaces': [] }))],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
