import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withToast, kbFrameRoute } from '../../../../.storybook/decorators';
import KbPage from './KbPage';

/**
 * ナレッジの画面（上に文脈バー、左に木、本文、右にレール）。
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
  visibility: 'space',
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
  workspaceCanEdit: true,
  canComment: true,
  ancestors: [],
  viewCount: 0,
  isFavorite: false,
  labels: [],
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
  // 版・コメント・お気に入りの宛先も `/kb/workspaces` を部分文字列として含むので、その前に置く
  // （後ろだと workspaces の一覧が版の応答として使われ、author の無い行で画面が落ちる）。
  '/pages/p-1/versions': [],
  '/pages/p-1/comment-threads': [],
  '/pages/p-1/favorite': () => undefined,
  '/spaces/s-1/pages': tree,
  '/spaces': spaces,
  '/kb/workspaces': workspaces,
  ...over,
});

/** ページを開いているとき。 */
export const ページを開く: Story = {
  decorators: [kbFrameRoute('/kb/:pageId', '/kb/p-1'), withApi(api())],
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
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({
          canEdit: false,
          canComment: false,
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
    // 書けないことは言葉で示す。設定（…）は出さない。
    await expect(canvas.getByText('閲覧のみ')).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'その他の操作' })).toBeNull();
  },
};

/** 見られないページ・存在しないページ。どちらも同じ見え方にする（実在を読ませない）。 */
export const 見られないページ: Story = {
  decorators: [kbFrameRoute('/kb/:pageId', '/kb/p-404'), withApi(api())],
};

/** アイコンを付ける。一覧から選ぶと保存され、頭部の絵文字に変わる。 */
export const アイコンを付ける: Story = {
  decorators: [kbFrameRoute('/kb/:pageId', '/kb/p-1'), withApi(api())],
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
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
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
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
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
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({ canEdit: false, canComment: true }),
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
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
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
    // 名前が複数か所（一覧と差分の見出しなど）に出ても通るよう、件数で見る。
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
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
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
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('田中 太郎')).toBeVisible();
    await expect(canvas.getByText(/が最終編集/)).toBeVisible();
  },
};

/**
 * バイラインに公開範囲バッジ・ラベル・閲覧数が出る（段13・段2の応答を消費する）。
 * 読了時間は本文の文字数から手元で見積もる（backend の応答には無い）。
 */
export const バイラインに公開範囲とラベルと閲覧数が出る: Story = {
  decorators: [
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
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
 * 本文の器は 742px の読みの幅（左右の余白ぶんを足した幅で切る）。パンくず（ページの場所）と
 * 操作ボタンは別の行に分かれる。ページ単位の共有は持たないので、権限を変えられる人にも
 * 「共有」ボタンは出ない（見られる人はワークスペースとスペースの権限で決まる）。
 */
export const 幅とパンくずと操作の行: Story = {
  decorators: [kbFrameRoute('/kb/:pageId', '/kb/p-1'), withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const article = await canvas.findByRole('article');
    await expect(article.parentElement).toHaveClass('max-w-[calc(742px+3rem)]');

    // パンくずの行に操作ボタンは同居しない（別の行）。
    const nav = canvas.getByRole('navigation', { name: 'ページの場所' });
    const actions = await canvas.findByRole('group', { name: 'ページの操作' });
    await expect(nav.contains(actions)).toBe(false);

    await expect(canvas.queryByRole('button', { name: '共有' })).toBeNull();
  },
};

/** 記事の組み方の見本の本文。見出し・箱の引用・箇条書き・区切り線を一通り持つ。 */
const articleDoc = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        {
          type: 'text',
          text: 'ナレッジは「知識を残し、その知識を使って仕事を進める」ための場所です。ページは木の形で整理し、本文はブロックで書きます。',
        },
      ],
    },
    { type: 'heading', attrs: { level: 2, id: 'h-1' }, content: [{ type: 'text', text: 'ページの作り方' }] },
    {
      type: 'paragraph',
      content: [{ type: 'text', text: '左の列の「＋」から作ります。題名で Enter を押すと本文の先頭へ移り、そのまま書き始められます。' }],
    },
    {
      type: 'blockquote',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: '決めごと：ページは 1 つの話題につき 1 枚。長くなったら子ページに分ける。' }] },
        { type: 'paragraph', content: [{ type: 'text', text: '見直し：四半期ごとに、参照されていないページをアーカイブする。' }] },
      ],
    },
    { type: 'heading', attrs: { level: 3, id: 'h-2' }, content: [{ type: 'text', text: '本文で使えるブロック' }] },
    {
      type: 'bulletList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '見出し（h1〜h3）と段落' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '箇条書き・番号付き・チェックリスト' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '引用・コード・表・画像' }] }] },
      ],
    },
    { type: 'heading', attrs: { level: 2, id: 'h-3' }, content: [{ type: 'text', text: 'レビューの流れ' }] },
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: '編集できない人は「変更を提案する」から下書きを送れます。採用すると本文が置き換わり、版として残ります。' },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: '採用した提案は、履歴から元の版に戻せます。' }] },
    // 空行（空の段落）。段落の間は空けないので、空けたい所はこれで 1 行ぶん空ける。
    { type: 'paragraph' },
    { type: 'paragraph', content: [{ type: 'text', text: '提案は誰でも一覧で読めます。' }] },
    { type: 'horizontalRule' },
    { type: 'paragraph', content: [{ type: 'text', text: '困ったときは、右の欄の「コメント」から聞いてください。' }] },
  ],
};

/**
 * 本文の組み方（報道系サイトの記事面から借りた型）。題名は 24px（狭い画面では 20px）で、操作は
 * 最終編集の行の右端。本文は 16px/1.8 で段落の間は空けず、空行（空の段落）が 1 行ぶん空く。
 * 見出しは文字の大きさだけを変え（h2 は 20px）、地の色や枠は付けない。
 */
export const 記事の組み方: Story = {
  decorators: [
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/kb/pages/p-1': resolved({
          doc: articleDoc,
          lastEditedBy: { userId: 1, name: '田中 太郎' },
          lastEditedAt: '2026-09-01T10:00:00',
          viewCount: 42,
        }),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const article = await canvas.findByRole('article');
    const paragraph = await waitFor(() => {
      const found = article.querySelector('.ProseMirror p');
      if (!found) throw new Error('本文がまだ描かれていない');
      return found;
    });
    await expect(getComputedStyle(paragraph).lineHeight).toBe('28.8px');
    // 段落の間は空けない。空けたい所は空の段落で、1 行ぶん（28.8px）空く。
    await expect(getComputedStyle(paragraph).marginBottom).toBe('0px');
    const blank = [...article.querySelectorAll('.ProseMirror p')].find((p) => p.textContent === '') as HTMLElement;
    await expect(Math.abs(blank.getBoundingClientRect().height - 28.8)).toBeLessThan(1);
    // 見出しは文字の大きさだけを変える（地の色・帯は付けない）。
    const h2 = within(article).getByRole('heading', { level: 2, name: 'ページの作り方' });
    await expect(getComputedStyle(h2).fontSize).toBe('20px');
    await expect(getComputedStyle(h2).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    const title = canvas.getByRole('textbox', { name: 'ページの題名' });
    await expect(['24px', '20px']).toContain(getComputedStyle(title).fontSize);
    // 操作は最終編集の行の右端（パンくずの行にも、題名の上にも無い）。
    const actions = canvas.getByRole('group', { name: 'ページの操作' });
    await expect(within(actions).getByRole('button', { name: '目次' })).toBeVisible();
    await expect(within(actions).queryByRole('button', { name: '共有' })).toBeNull();
    await expect(actions.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
  },
};

/** 操作バーの「…」（その他の操作）を開いて、中の操作を返す。 */
async function findPageOption(canvas: ReturnType<typeof within>, name: string) {
  const toggle = await canvas.findByRole('button', { name: 'その他の操作' });
  if (toggle.getAttribute('aria-expanded') === 'false') await userEvent.click(toggle);
  return canvas.findByRole('button', { name });
}

const docWithHeadings = {
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'このページでは規約をまとめます。' }] },
    { type: 'heading', attrs: { level: 2, id: 'h-1' }, content: [{ type: 'text', text: '命名' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'コンポーネントは PascalCase。' }] },
    { type: 'heading', attrs: { level: 3, id: 'h-2' }, content: [{ type: 'text', text: 'ファイル名' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'コンポーネント名と一致させる。' }] },
    { type: 'heading', attrs: { level: 2, id: 'h-3' }, content: [{ type: 'text', text: 'レビュー' }] },
    { type: 'paragraph', content: [{ type: 'text', text: 'PR は 400 行以内を目安にする。' }] },
  ],
};

/**
 * 右レールは広い画面では目次を開いた状態から始まる（見本 3a の既定）。目次は本文の見出しから
 * 作り、3 段目は字下げして並ぶ。押すとその見出しへ移る。
 */
export const 右レールの目次: Story = {
  decorators: [
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
    withApi(api({ '/kb/pages/p-1': resolved({ doc: docWithHeadings }) })),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = await canvas.findByRole('complementary', { name: 'ページの補助' });
    await expect(within(rail).getByRole('tab', { name: '目次' })).toHaveAttribute('aria-selected', 'true');
    const toc = within(rail).getByRole('navigation', { name: '目次' });
    for (const label of ['命名', 'ファイル名', 'レビュー']) {
      await expect(within(toc).getByRole('button', { name: label })).toBeVisible();
    }
    // 3 段目は 2 段目より字下げされる。
    const h2Padding = parseFloat(getComputedStyle(within(toc).getByRole('button', { name: '命名' })).paddingLeft);
    const h3Padding = parseFloat(getComputedStyle(within(toc).getByRole('button', { name: 'ファイル名' })).paddingLeft);
    await expect(h3Padding).toBeGreaterThan(h2Padding);
    await userEvent.click(within(toc).getByRole('button', { name: 'レビュー' }));
    // 操作バーの「目次」は押された状態。
    await expect(canvas.getByRole('button', { name: '目次' })).toHaveAttribute('aria-expanded', 'true');
  },
};

/** 操作バーのコメント・履歴・提案はレールの同じ名前のタブを開く。同時に見えるのは 1 つで、閉じるボタンで本文が広がる。 */
export const 右レールのタブを切り替える: Story = {
  decorators: [
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
    withApi(
      api({
        '/pages/p-1/versions': [
          { seq: 2, author: { userId: 1, name: '田中 太郎' }, note: 'レビュー節を追記', createdAt: '2026-09-04T11:20:00' },
          { seq: 1, author: { userId: 2, name: '鈴木 花子' }, note: null, createdAt: '2026-08-21T09:05:00' },
        ],
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('complementary', { name: 'ページの補助' });
    await userEvent.click(canvas.getByRole('button', { name: '履歴' }));
    const rail = canvas.getByRole('complementary', { name: 'ページの補助' });
    await expect(within(rail).getByRole('tab', { name: '履歴' })).toHaveAttribute('aria-selected', 'true');
    await expect(await within(rail).findByText('レビュー節を追記')).toBeVisible();

    // タブを直接押しても切り替わる。
    await userEvent.click(within(rail).getByRole('tab', { name: 'コメント' }));
    await expect(await within(rail).findByText('まだコメントはありません。')).toBeVisible();
    // 中身の見出し（h3）の上に、タブ名の h2 が読み上げ用に入る（題名の h1 から段を飛ばさない）。
    await expect(within(rail).getByRole('heading', { level: 2, name: 'コメント' })).toBeInTheDocument();
    await expect(within(rail).getByRole('heading', { level: 3, name: '新しいスレッドを作成' })).toBeInTheDocument();
    await expect(within(rail).queryByText('レビュー節を追記')).toBeNull();

    await userEvent.click(within(rail).getByRole('button', { name: '補助を閉じる' }));
    await waitFor(async () => {
      await expect(canvas.queryByRole('complementary', { name: 'ページの補助' })).toBeNull();
    });
    // 閉じた後は操作バーから開き直せる。
    await userEvent.click(canvas.getByRole('button', { name: 'コメント' }));
    await expect(await canvas.findByRole('complementary', { name: 'ページの補助' })).toBeVisible();
  },
};

/** 操作バーの星。押すとその場で塗られ、もう一度押すと外れる。 */
export const お気に入りの星: Story = {
  decorators: [kbFrameRoute('/kb/:pageId', '/kb/p-1'), withApi(api())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const star = await canvas.findByRole('button', { name: 'お気に入りに追加' });
    await expect(star).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(star);
    await expect(await canvas.findByRole('button', { name: 'お気に入りから外す' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(canvas.getByRole('button', { name: 'お気に入りから外す' }));
    await expect(await canvas.findByRole('button', { name: 'お気に入りに追加' })).toHaveAttribute('aria-pressed', 'false');
  },
};

/** 保存状態はバイラインの右端。読み上げ用の領域は最初から置き、本文を書き換えると文字が入る。 */
export const 保存状態はバイラインに出る: Story = {
  decorators: [
    kbFrameRoute('/kb/:pageId', '/kb/p-1'),
    withApi(api({ '/pages/p-1/content': () => ({ ...resolved(), doc }) })),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const status = await canvas.findByRole('status', { name: '保存状態' });
    await expect(status).toHaveTextContent('');
    const body = await canvas.findByRole('textbox', { name: '設計メモ の本文' });
    await userEvent.click(body);
    await userEvent.keyboard('追記');
    await waitFor(async () => {
      await expect(status).toHaveTextContent(/未保存|保存中|保存済み/);
    });
  },
};

/** 狭い画面では右レールは右から出る引き出しになる。Escape で閉じて、押したボタンへ戻る。 */
export const 狭い画面の補助: Story = {
  decorators: [kbFrameRoute('/kb/:pageId', '/kb/p-1'), withApi(api())],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 狭い画面では最初は閉じている（本文の上に重なる物を勝手に出さない）。
    const button = await canvas.findByRole('button', { name: 'コメント' });
    await expect(canvas.queryByRole('dialog', { name: 'ページの補助' })).toBeNull();
    await userEvent.click(button);
    const drawer = await canvas.findByRole('dialog', { name: 'ページの補助' });
    await expect(within(drawer).getByRole('tab', { name: 'コメント' })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Escape}');
    await waitFor(async () => {
      await expect(canvas.queryByRole('dialog', { name: 'ページの補助' })).toBeNull();
    });
    await waitFor(async () => {
      await expect(button).toHaveFocus();
    });
  },
};
