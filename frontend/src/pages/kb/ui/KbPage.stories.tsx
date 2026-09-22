import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withToast, routerWithParam } from '../../../../.storybook/decorators';
import KbPage from './KbPage';

/**
 * ナレッジの画面（左に木、右に本文）。
 *
 * URL は `/kb/:pageId` だけで、ワークスペースやスペースは出さない。どのページかが決まれば
 * 場所は引けるので、URL に階層を並べても長くなるだけで、階層を組み替えるたびにリンクが
 * 切れることになる。
 *
 * ページを指さずに `/kb` を開いたときは、前に見ていたページか、見えるうちの最初のページへ
 * その場で移る（行き止まりの空の画面を出さないため）。
 */
const meta = {
  title: 'pages/kb/KbPage',
  component: KbPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast],
} satisfies Meta<typeof KbPage>;

export default meta;
type Story = StoryObj<typeof meta>;

const workspaces = [
  { slug: 'w-3f2a9c', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true },
];

const spaces = [
  { id: 's-1', key: 's-1a2b3c', name: 'バックエンド定例', createdAt: '2026-01-01T00:00:00Z' },
];

const page = {
  id: 'p-1',
  spaceId: 's-1',
  title: '設計メモ',
  createdByUserId: 1,
  createdAt: '2026-09-01T00:00:00Z',
  updatedAt: '2026-09-01T00:00:00Z',
};

const tree = {
  pages: [
    { page, children: [], hasHiddenChildren: false, parentArchived: false },
    {
      page: { ...page, id: 'p-2', title: '議事録' },
      children: [],
      hasHiddenChildren: false,
      parentArchived: false,
    },
  ],
  hasHiddenChildren: false,
};

const doc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'ページとブロックを分けて持つ、という決めごとの記録。' }],
    },
  ],
};

const resolved = (over: Record<string, unknown> = {}) => ({
  workspaceSlug: 'w-3f2a9c',
  workspaceName: '開発チーム',
  page,
  doc,
  canEdit: true,
  canManage: true,
  workspaceCanEdit: true,
  ...over,
});

/**
 * PUT(設定) / DELETE(解除) を method で撃ち分ける。
 *
 * withApi は URL の**部分一致**で見本を選び、method は見ない。icon の宛先
 * （`/kb/workspaces/…/pages/p-1/icon`）は `/kb/workspaces` を部分文字列として含むので、
 * この宛先を `/kb/workspaces` より**前**に置かないと、そちらの見本（一覧）に取られる。
 */
const iconStub = (config: { method?: string }) =>
  config.method === 'delete'
    ? { ...page, icon: null }
    : { ...page, icon: { type: 'emoji', value: '📘' } };

// 突き合わせは前から順。細かい宛先を先に書く。
const api = (over: Record<string, unknown> = {}) => ({
  '/kb/pages/p-1': resolved(),
  '/pages/p-1/icon': iconStub,
  // 逆リンクの宛先（.../pages/p-1/backlinks）は `/kb/workspaces` を部分文字列として
  // 含むため、iconStub と同じ理由でそちらより前に置く（後ろだと workspaces の一覧が
  // 誤って backlinks の応答として使われ、意図しない逆リンクセクションが出てしまう）。
  '/pages/p-1/backlinks': [],
  // 提案系の宛先も `/kb/workspaces` を部分文字列として含むため、同じ理由でそちらより前に
  // 置く。採用・却下（.../suggestions/:id/accept|reject）は一覧（.../suggestions）を
  // 部分文字列として含むので、この中でも採用・却下を先に書く。既定は「何も無い」に倒し、
  // 各 story は `over` で同じキー名を上書きする（同名キーの再定義は元の並び順を保ったまま
  // 値だけ差し替わる — ECMAScript の仕様どおりの挙動）。
  '/pages/p-1/suggestions/s-1/accept': () => ({
    id: 's-1',
    doc,
    status: 'accepted',
    author: { userId: 1, name: '' },
    createdAt: '2026-09-01T00:00:00Z',
  }),
  '/pages/p-1/suggestions/s-1/reject': () => ({
    id: 's-1',
    doc,
    status: 'rejected',
    author: { userId: 1, name: '' },
    createdAt: '2026-09-01T00:00:00Z',
  }),
  '/pages/p-1/suggestions': [],
  '/spaces/s-1/pages': tree,
  '/spaces': spaces,
  '/kb/workspaces': workspaces,
  ...over,
});

/** ページを開いているとき。 */
export const ページを開く: Story = {
  decorators: [routerWithParam('/kb/:pageId', '/kb/p-1'), withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      async () => {
        await expect(canvas.getByDisplayValue('設計メモ')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
  },
};

/** 読むだけの人が開いたとき。題名も本文も打ち替えられない。アイコンも押せない。 */
export const 読むだけ: Story = {
  decorators: [
    routerWithParam('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({
          canEdit: false,
          canManage: false,
          page: { ...page, icon: { type: 'emoji', value: '📘' } },
        }),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: '設計メモ' })).toBeInTheDocument();
    // アイコンは img として出るだけで、押せるボタンにはならない。
    await expect(canvas.getByRole('img', { name: 'ページのアイコン' })).toHaveTextContent('📘');
    await expect(canvas.queryByRole('button', { name: 'アイコンを追加' })).toBeNull();
    await expect(canvas.queryByRole('button', { name: 'ページのアイコンを変更' })).toBeNull();
  },
};

/** 見られないページ・存在しないページ。どちらも同じ見え方にする（実在を読ませない）。 */
export const 見られないページ: Story = {
  decorators: [routerWithParam('/kb/:pageId', '/kb/p-404'), withApi(api())],
};

/** アイコンを付ける。一覧から選ぶと保存され、頭部の絵文字に変わる。 */
export const アイコンを付ける: Story = {
  decorators: [routerWithParam('/kb/:pageId', '/kb/p-1'), withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const addButton = await findPageOption(canvas, 'アイコンを追加');
    await userEvent.click(addButton);

    const dialog = await canvas.findByRole('dialog', { name: 'ページのアイコンを選ぶ' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'アイコンを 📘 にする' }));

    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: 'ページのアイコンを変更' })).toBeInTheDocument();
    });
    await expect(canvasElement.querySelector('[data-icon="emoji"]')).toHaveTextContent('📘');
  },
};

/** アイコンを外す。 */
export const アイコンを外す: Story = {
  decorators: [
    routerWithParam('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({ page: { ...page, icon: { type: 'emoji', value: '📘' } } }),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const iconButton = await findPageOption(canvas, 'ページのアイコンを変更');
    await userEvent.click(iconButton);

    const dialog = await canvas.findByRole('dialog', { name: 'ページのアイコンを選ぶ' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'アイコンを外す' }));

    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: 'アイコンを追加' })).toBeInTheDocument();
    });
  },
};

/** アイコンの変更に失敗。トーストで知らせ、ピッカーは開いたまま。 */
export const アイコンの変更に失敗: Story = {
  decorators: [
    routerWithParam('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/pages/p-1/icon': () => {
          throw new Error('invalid_icon');
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await findPageOption(canvas, 'アイコンを追加'));
    const dialog = await canvas.findByRole('dialog', { name: 'ページのアイコンを選ぶ' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'アイコンを 📘 にする' }));

    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('アイコンを変更できませんでした');
    });
    // 失敗したのでピッカーは開いたまま。
    await expect(canvas.getByRole('dialog', { name: 'ページのアイコンを選ぶ' })).toBeInTheDocument();
  },
};

/**
 * commenter（閲覧+コメントはできるが編集はできない役割）が「変更を提案する」を送信する。
 * 送信すると本文は変わらないまま（実際の本文は変えず、提案として積まれるだけ）、
 * ドラフトモードを終え通常表示に戻り、成功のトーストが出る。
 */
export const 提案を送信する: Story = {
  decorators: [
    routerWithParam('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({ canEdit: false, canManage: false, canComment: true }),
        '/pages/p-1/suggestions': (config: { method?: string }) =>
          config.method === 'post'
            ? {
                id: 'sugg-1',
                doc,
                status: 'open',
                author: { userId: 9, name: '山田 太郎' },
                createdAt: '2026-09-01T00:00:00Z',
              }
            : [],
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '変更を提案する' }));
    await expect(canvas.getByText(/提案として保存されます/)).toBeVisible();

    await userEvent.click(canvas.getByRole('button', { name: '送信' }));

    await waitFor(async () => {
      await expect(canvas.queryByText(/提案として保存されます/)).not.toBeInTheDocument();
    });
    // トーストのフェードイン途中はDOMに存在してもtoBeVisibleを満たさないことが
    // CI環境（実ブラウザ）でだけ起きるため、アニメーションが収まるまでwaitForで待つ。
    await waitFor(async () => {
      await expect(screen.getByText('提案として送信しました')).toBeVisible();
    });
  },
};

/**
 * editor が「提案」パネルを開き、開いている提案を採用する。採用すると一覧からその提案が消える
 * （backend が反映後の本文を返すので、フロントは本文を再取得して画面へ映す）。
 */
export const 提案を採用する: Story = {
  decorators: [
    routerWithParam('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/pages/p-1/suggestions/s-1/accept': () => ({
          id: 's-1',
          doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '採用後の本文' }] }] },
          status: 'accepted',
          author: { userId: 2, name: '鈴木 花子' },
          createdAt: '2026-09-01T09:00:00Z',
          resolvedAt: '2026-09-01T10:00:00Z',
          resolvedBy: { userId: 1, name: '田中 太郎' },
        }),
        '/pages/p-1/suggestions': [
          {
            id: 's-1',
            baseSeq: 1,
            baseDoc: doc,
            doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: '採用後の本文' }] }] },
            status: 'open',
            author: { userId: 2, name: '鈴木 花子' },
            createdAt: '2026-09-01T09:00:00Z',
          },
        ],
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '提案' }));
    // SecondaryPanel はモバイル版（隠れている）・デスクトップ版の両方に同じ中身を描くため
    // 常に2つ出る。片方は非表示なので toBeVisible ではなく件数だけ見る。
    await expect((await canvas.findAllByText('鈴木 花子')).length).toBeGreaterThan(0);

    await userEvent.click(canvas.getAllByRole('button', { name: '採用' })[0]);

    await waitFor(async () => {
      await expect(canvas.queryByText('鈴木 花子')).not.toBeInTheDocument();
    });
  },
};

/** 最終編集が出る。 */
export const 最終編集が出る: Story = {
  decorators: [
    routerWithParam('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({
          lastEditedBy: { userId: 1, name: '田中 太郎' },
          lastEditedAt: '2026-09-01T10:00:00',
        }),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByText(/最終編集 田中 太郎/),
    ).toBeVisible();
  },
};

/**
 * バイラインに公開範囲バッジ・ラベル・閲覧数が出る（段13・段2の応答を消費する）。
 * 読了時間は本文の文字数から手元で見積もる（backend の応答には無い）。
 */
export const バイラインに公開範囲とラベルと閲覧数が出る: Story = {
  decorators: [
    routerWithParam('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({
          lastEditedBy: { userId: 1, name: '田中 太郎' },
          lastEditedAt: '2026-09-01T10:00:00',
          page: { ...page, visibility: 'private' },
          labels: [{ id: 'l-1', spaceId: 's-1', name: 'ガイドライン', color: '#1d4ed8', createdAt: '', updatedAt: '' }],
          viewCount: 42,
        }),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('非公開')).toBeVisible();
    await expect(canvas.getByText('ガイドライン')).toBeVisible();
    await expect(canvas.getByText('閲覧 42')).toBeVisible();
    await expect(canvas.getByText(/読了 \d+ 分/)).toBeVisible();
  },
};

/**
 * 本文の幅は 900px 相当。パンくず（ページの場所）と操作ボタンは別の行に分かれ、
 * 「共有」は塗りの主ボタンになる。
 */
export const 幅とパンくずと共有ボタン: Story = {
  decorators: [routerWithParam('/kb/:pageId', '/kb/p-1'), withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const article = await canvas.findByRole('article');
    await expect(article.parentElement).toHaveClass('max-w-[900px]');

    const share = canvas.getByRole('button', { name: '共有' });
    await expect(share).toHaveClass('bg-brand-600');

    // パンくずの行に操作ボタンは同居しない（別の行）。
    const nav = canvas.getByRole('navigation', { name: 'ページの場所' });
    await expect(within(nav).queryByRole('button', { name: '共有' })).toBeNull();
  },
};

async function findPageOption(canvas: ReturnType<typeof within>, name: string) {
  const toggle = await canvas.findByRole('button', { name: 'ページの設定とその他の操作' });
  if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle);
  return canvas.findByRole('button', { name });
}
