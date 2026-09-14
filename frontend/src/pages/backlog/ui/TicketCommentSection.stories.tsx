import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import TicketCommentSection from './TicketCommentSection';
import { withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';

const PROFILE = { userId: 1, displayName: 'norman6464', email: '', bio: '', avatarUrl: '', status: '', updatedAt: '' };

function comment(over: Record<string, unknown> & { id: string }) {
  return {
    parentCommentId: undefined,
    author: { userId: 1, name: '田中 太郎' },
    body: [{ type: 'text', text: 'コメント本文' }],
    edited: false,
    reactions: [],
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    ...over,
  };
}

const MEMBERS = [
  { principalId: 'p-1', userId: 1, name: 'norman6464' },
  { principalId: 'p-2', userId: 2, name: '佐藤 花子' },
];

function baseApi(over: ApiStubs = {}): ApiStubs {
  return {
    '/profile/me': PROFILE,
    '/workspaces/acme/tickets/t-1/comments': { comments: [] },
    '/kb/workspaces/acme/members': MEMBERS,
    ...over,
  };
}

const meta = {
  title: 'pages/backlog/TicketCommentSection',
  component: TicketCommentSection,
  args: { workspaceSlug: 'acme', ticketId: 't-1' },
  decorators: [withToast, (Story) => <div className="w-[420px] bg-surface-1 p-3"><Story /></div>],
} satisfies Meta<typeof TicketCommentSection>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * 新規のコメント欄は畳んだ姿から始まる（設計 04・06）。開くまで入力欄は無いので、
 * 置き文句のボタンを押してから中身を確かめる。
 */
async function openComposer(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByRole('button', { name: 'コメントを追加する...' }));
  return canvas.findByRole('textbox', { name: 'コメントを追加する...' });
}

export const 空: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('まだコメントはありません')).toBeInTheDocument();
    });
    // 畳んだ姿では入力欄は無く、置き文句だけが出る。
    await expect(canvas.getByRole('button', { name: 'コメントを追加する...' })).toBeInTheDocument();
    await expect(canvas.queryByRole('textbox')).toBeNull();

    await openComposer(canvas);
    await expect(canvas.getByRole('textbox', { name: 'コメントを追加する...' })).toBeInTheDocument();
  },
};

export const 失敗: Story = {
  decorators: [
    withApi({
      '/profile/me': PROFILE,
      '/workspaces/acme/tickets/t-1/comments': () => {
        const err = new Error('network') as Error & { isAxiosError: boolean; response: unknown };
        err.isAxiosError = true;
        err.response = { status: 500, data: {} };
        throw err;
      },
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('読み込めませんでした');
    });
    await expect(canvas.getByRole('button', { name: '再読み込み' })).toBeInTheDocument();
  },
};

export const 返信つき: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/tickets/t-1/comments': {
          comments: [
            comment({ id: 'c-1' }),
            comment({ id: 'c-2', parentCommentId: 'c-1', author: { userId: 2, name: '佐藤 花子' }, body: [{ type: 'text', text: '返信です' }] }),
          ],
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('返信です')).toBeInTheDocument();
    });
    await expect(canvas.getAllByRole('article')).toHaveLength(2);
  },
};

export const 反応つき自分の発言には操作が出る: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/tickets/t-1/comments': {
          comments: [comment({ id: 'c-1', reactions: [{ userId: 1, emoji: '👍' }, { userId: 2, emoji: '👍' }] })],
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByLabelText('👍 の反応 2 件（自分も押しています）')).toBeInTheDocument();
    });
    // author.userId(1) === profile.userId(1) なので自分の発言。操作メニューが出る。
    await expect(canvas.getByRole('button', { name: '田中 太郎 の発言の操作' })).toBeInTheDocument();
  },
};

export const 他人の発言には操作が出ない: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/tickets/t-1/comments': {
          comments: [comment({ id: 'c-1', author: { userId: 99, name: '鈴木 一郎' } })],
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('鈴木 一郎')).toBeInTheDocument();
    });
    await expect(canvas.queryByRole('button', { name: '鈴木 一郎 の発言の操作' })).toBeNull();
  },
};

export const 反応ピッカーを開く: Story = {
  decorators: [withApi(baseApi({ '/workspaces/acme/tickets/t-1/comments': { comments: [comment({ id: 'c-1' })] } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByLabelText('反応を付ける')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByLabelText('反応を付ける'));
    await expect(canvas.getByRole('group', { name: '反応を選ぶ' })).toBeInTheDocument();
    await expect(canvas.getByLabelText('🚀 の反応を付ける')).toBeInTheDocument();
  },
};

export const 編集済みの履歴を開く: Story = {
  decorators: [
    // withApi は部分一致なので、より具体的な /edits を /comments より先に置く
    // （baseApi のマージだと /comments が先に定義されていて先に当たってしまう）。
    withApi({
      '/workspaces/acme/tickets/t-1/comments/c-1/edits': {
        edits: [{ id: 'e-1', editor: { userId: 1, name: '田中 太郎' }, previousBody: [{ type: 'text', text: '直す前' }], editedAt: '2026-09-09T00:00:00Z' }],
      },
      ...baseApi({ '/workspaces/acme/tickets/t-1/comments': { comments: [comment({ id: 'c-1', edited: true })] } }),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: '田中 太郎 の編集履歴を開く' })).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole('button', { name: '田中 太郎 の編集履歴を開く' }));
    await waitFor(async () => {
      await expect(canvas.getByText('直す前')).toBeInTheDocument();
    });
  },
};

export const 空白だけの返信は送信できない: Story = {
  decorators: [withApi(baseApi({ '/workspaces/acme/tickets/t-1/comments': { comments: [comment({ id: 'c-1' })] } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByRole('button', { name: '返信' })).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole('button', { name: '返信' }));
    const replyBox = await canvas.findByRole('textbox', { name: '返信を書く' });
    await userEvent.type(replyBox, '   ');
    // 「返信」という名前のボタンが開閉トグルと送信の 2 つあるので、送信ボタン
    // （入力欄と同じコンポーザの中）に絞って確かめる。
    // 入力欄の囲み（枠線つき）と保存/キャンセルの行は兄弟なので、囲みの親まで上がる。
    const composer = within(replyBox.closest('.rounded-lg')?.parentElement as HTMLElement);
    await expect(composer.getByRole('button', { name: '返信' })).toBeDisabled();
  },
};

export const 名指しの候補から選んで送信する: Story = {
  decorators: [
    withApi(
      baseApi({
        '/workspaces/acme/tickets/t-1/comments': (config: { method?: string; data?: unknown }) => {
          if (config.method !== 'post') return { comments: [] };
          const sent = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
          return comment({ id: 'c-new', author: { userId: 1, name: 'norman6464' }, body: (sent as { body: unknown }).body });
        },
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openComposer(canvas);
    await userEvent.type(box, '@佐藤');
    // 候補の一覧は floating-ui でキャンバスの外（document 直下）へ描かれるため、
    // canvasElement には閉じない screen で探す（slashCommand.integration.test.tsx と同じ理由）。
    await waitFor(async () => {
      await expect(screen.getByRole('option', { name: /佐藤 花子/ })).toBeInTheDocument();
    });
    await userEvent.click(screen.getByRole('option', { name: /佐藤 花子/ }));
    await userEvent.click(canvas.getByRole('button', { name: '保存' }));
    await waitFor(async () => {
      await expect(canvas.getByText('@佐藤 花子')).toBeInTheDocument();
    });
  },
};

/**
 * Enter は「選んでいる候補を確定する」（改行にならない）。CommentComposerEnter（改行を
 * hardBreak に固定する拡張）が候補一覧より先に Enter を食ってしまう回帰を防ぐための story
 * （実際に一度この壊れ方をした — mentionExtension.ts の doc 参照）。
 */
export const 候補が出ているときのEnterは改行にならず確定する: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openComposer(canvas);
    await userEvent.type(box, '@');
    await waitFor(async () => {
      await expect(screen.getByRole('option', { name: /norman6464/ })).toBeInTheDocument();
    });
    await userEvent.keyboard('{Enter}');
    await waitFor(async () => {
      await expect(canvas.getByText('@norman6464')).toBeInTheDocument();
    });
    // 改行（hardBreak）を挟んで二重に確定していない — 名指しは 1 個だけ。
    await expect(canvas.getAllByText('@norman6464')).toHaveLength(1);
  },
};

export const 反応12種の格子が全部見える: Story = {
  decorators: [withApi(baseApi({ '/workspaces/acme/tickets/t-1/comments': { comments: [comment({ id: 'c-1' })] } }))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByLabelText('反応を付ける')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByLabelText('反応を付ける'));
    for (const emoji of ['👍', '🙏', '🎉', '👀', '✅', '❤️', '😄', '🤔', '🚀', '🔥', '⚠️', '😢']) {
      await expect(canvas.getByLabelText(`${emoji} の反応を付ける`)).toBeInTheDocument();
    }
  },
};

/**
 * 書式バー（design.pen 05）。太字・斜体・打ち消し・コード・リンクと、箇条書き・番号付き。
 *
 * 見出し・引用・コードの囲みは出さない —— 発言は短い文の往復で、節を立てる場所ではないため。
 */
export const 書式バーが出る: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openComposer(canvas);

    const toolbar = within(canvas.getByRole('toolbar', { name: '発言の書式' }));
    for (const label of ['太字', '斜体', '打ち消し', 'コード', '箇条書き', '番号付き', 'リンク']) {
      await expect(toolbar.getByRole('button', { name: label })).toBeInTheDocument();
    }
    // 節を立てる書式は出さない。
    await expect(toolbar.queryByRole('button', { name: '見出し' })).toBeNull();
    await expect(toolbar.queryByRole('button', { name: '引用' })).toBeNull();
  },
};

/** 送った本文をそのまま返す stub（書いた形が表示側でどう出るかを見る story 用）。 */
function echoComments(): ApiStubs {
  return baseApi({
    '/workspaces/acme/tickets/t-1/comments': (config: { method?: string; data?: unknown }) => {
      if (config.method !== 'post') return { comments: [] };
      const sent = typeof config.data === 'string' ? JSON.parse(config.data) : config.data;
      return comment({ id: 'c-new', author: { userId: 1, name: 'norman6464' }, body: (sent as { body: unknown }).body });
    },
  });
}

/**
 * 箇条書きで書いて送ると、表示側でも箇条書きとして出る。
 *
 * 入力欄（tiptap の bulletList）→ wire（kind:'list'）→ 表示（<ul><li>）の 3 段の往復を
 * 1 本で見る story。どこか 1 段が段落へ潰れると項目が 1 つも見つからず落ちる。
 */
export const 箇条書きで書いて送ると箇条書きで出る: Story = {
  decorators: [withApi(echoComments())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openComposer(canvas);
    await userEvent.click(box);

    await userEvent.click(canvas.getByRole('button', { name: '箇条書き' }));
    await expect(canvas.getByRole('button', { name: '箇条書き' })).toHaveAttribute('aria-pressed', 'true');

    // 打ち込みは keyboard で行う（type は先に要素の中心をクリックするので、箇条書きの
    // 後ろに付く空段落——StarterKit の trailingNode——へカーソルが落ちて項目の外に書けてしまう）。
    await userEvent.keyboard('一つ目');
    // 項目の中の Enter は次の項目（改行ではない）。
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard('二つ目');

    await userEvent.click(canvas.getByRole('button', { name: '保存' }));

    await waitFor(async () => {
      await expect(canvas.getByRole('article')).toBeInTheDocument();
    });
    const posted = within(canvas.getByRole('article'));
    const items = posted.getAllByRole('listitem');
    await expect(items).toHaveLength(2);
    await expect(items[0]).toHaveTextContent('一つ目');
    await expect(items[1]).toHaveTextContent('二つ目');
  },
};

/** 番号付きは <ol> で出る（点ではなく数字。表示側の list-decimal）。 */
export const 番号付きで書いて送ると番号付きで出る: Story = {
  decorators: [withApi(echoComments())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openComposer(canvas);
    await userEvent.click(box);

    await userEvent.click(canvas.getByRole('button', { name: '番号付き' }));
    await userEvent.keyboard('手順');
    await userEvent.click(canvas.getByRole('button', { name: '保存' }));

    await waitFor(async () => {
      await expect(canvas.getByRole('article')).toBeInTheDocument();
    });
    const list = within(canvas.getByRole('article')).getByRole('list');
    await expect(list.tagName).toBe('OL');
    await expect(list).toHaveTextContent('手順');
  },
};

/** 押すと押下状態になる（選択が動いても追随する）。 */
export const 太字を押すと押下状態になる: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const box = await openComposer(canvas);
    await userEvent.type(box, 'ここ');

    const bold = canvas.getByRole('button', { name: '太字' });
    await expect(bold).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(bold);
    await expect(bold).toHaveAttribute('aria-pressed', 'true');
  },
};
