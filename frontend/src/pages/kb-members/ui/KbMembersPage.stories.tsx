import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { AxiosError } from 'axios';
import KbMembersPage from './KbMembersPage';
import { routerWithParam, withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';
import type { KbInvitation } from '@/entities/kb';

const member = (over: Record<string, unknown>) => ({
  principalId: 'p-1',
  userId: 1,
  name: '田中 太郎',
  accountStatus: 'active',
  avatarUrl: '',
  statusMessage: '',
  role: 'editor',
  ...over,
});

/** apiClient のスタブがそのまま投げても getApiError（AxiosError 前提）が読めるよう、本物の AxiosError を作る。 */
function stubError(status: number, serverCode: string) {
  return () => {
    throw new AxiosError(
      'stub error',
      undefined,
      undefined,
      undefined,
      // @ts-expect-error -- story のスタブ用に最小限だけ埋める。
      { status, data: { error: serverCode }, statusText: '', headers: {}, config: {} },
    );
  };
}

function baseApi(over: ApiStubs = {}): ApiStubs {
  return {
    '/profile/me': {
      userId: 1,
      displayName: '田中 太郎',
      email: 'a@example.com',
      bio: '',
      avatarUrl: '',
      status: '',
      updatedAt: '2026-01-01T00:00:00Z',
    },
    '/kb/workspaces/acme/admin/members': [
      member({ principalId: 'p-1', userId: 1, name: '田中 太郎', role: 'admin' }),
      member({ principalId: 'p-2', userId: 2, name: '佐藤 花子', role: 'editor' }),
      member({ principalId: 'p-3', userId: 3, name: '鈴木 一郎', role: undefined }),
    ],
    ...over,
  };
}

const meta = {
  title: 'pages/kb-members/KbMembersPage',
  component: KbMembersPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast, routerWithParam('/kb/:workspaceSlug/members', '/kb/acme/members')],
} satisfies Meta<typeof KbMembersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** admin が開いた通常の一覧。自分自身には操作を出さず、役割の無いメンバーもそれと分かる形で出す。 */
export const ふつう: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('田中 太郎')).toBeInTheDocument();
    });
    await expect(canvas.getByText('自分')).toBeInTheDocument();
    await expect(canvas.getByText('自分自身は操作できません')).toBeInTheDocument();
    // role を持たない鈴木一郎の select は「役割なし」（空文字）が選ばれている。
    await expect(canvas.getByRole('combobox', { name: '鈴木 一郎 の役割' })).toHaveValue('');
  },
};

/** 停止中のメンバーが混ざっている。行が沈み、復帰ボタンだけが目立つ。 */
export const 停止中のメンバーがいる: Story = {
  decorators: [
    withApi(
      baseApi({
        '/kb/workspaces/acme/admin/members': [
          member({ principalId: 'p-1', userId: 1, name: '田中 太郎', role: 'admin' }),
          member({ principalId: 'p-4', userId: 4, name: '高橋 次郎', role: 'editor', accountStatus: 'suspended' }),
        ],
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('停止中')).toBeInTheDocument();
    });
    await expect(canvas.getByRole('button', { name: '高橋 次郎 を復帰させる' })).toBeInTheDocument();
    // 停止中は役割 select ではなく素のテキストで出す（変えても意味が無いため）。
    await expect(canvas.queryByRole('combobox', { name: '高橋 次郎 の役割' })).not.toBeInTheDocument();
  },
};

/** admin でない相手が開くと 403 → 入口そのものを出さない画面になる。 */
export const admin以外は開けない: Story = {
  decorators: [
    withApi({
      '/profile/me': {
        userId: 9,
        displayName: '一般メンバー',
        email: 'b@example.com',
        bio: '',
        avatarUrl: '',
        status: '',
        updatedAt: '2026-01-01T00:00:00Z',
      },
      '/kb/workspaces/acme/admin/members': stubError(403, 'forbidden'),
    }),
  ],
  play: async ({ canvasElement }) => {
    await waitFor(async () => {
      await expect(
        within(canvasElement).getByText('この画面は admin だけが開けます'),
      ).toBeInTheDocument();
    });
  },
};

/**
 * 役割の select を変えるとその場で反映される（保存ボタンを挟まない）。
 *
 * useKbAdminMembers は楽観更新をせず、書き込み成功後に一覧を引き直す設計なので、
 * 一覧のスタブも書き込みを受けて中身が変わる関数にする（固定の配列だと、成功しても
 * 引き直した瞬間に元の役割へ戻って見えてしまう）。
 */
export const 役割を変更する: Story = {
  decorators: [
    withApi(
      (() => {
        let role = 'editor';
        return baseApi({
          '/kb/workspaces/acme/admin/members': () => [
            member({ principalId: 'p-1', userId: 1, name: '田中 太郎', role: 'admin' }),
            member({ principalId: 'p-2', userId: 2, name: '佐藤 花子', role }),
            member({ principalId: 'p-3', userId: 3, name: '鈴木 一郎', role: undefined }),
          ],
          '/kb/workspaces/acme/grants/p-2': () => {
            role = 'admin';
            return { principalId: 'p-2', role, createdAt: '', updatedAt: '' };
          },
        });
      })(),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const select = await canvas.findByRole('combobox', { name: '佐藤 花子 の役割' });
    await expect(select).toHaveValue('editor');
    await userEvent.selectOptions(select, 'admin');
    await waitFor(async () => {
      await expect(canvas.getByRole('combobox', { name: '佐藤 花子 の役割' })).toHaveValue('admin');
    });
  },
};

/** 停止ボタンを押すとその場で「停止中」に変わる（同じ理由で一覧のスタブを可変にする）。 */
export const 停止する: Story = {
  decorators: [
    withApi(
      (() => {
        let suspended = false;
        return baseApi({
          '/kb/workspaces/acme/admin/members': () => [
            member({ principalId: 'p-1', userId: 1, name: '田中 太郎', role: 'admin' }),
            member({
              principalId: 'p-2',
              userId: 2,
              name: '佐藤 花子',
              role: 'editor',
              accountStatus: suspended ? 'suspended' : 'active',
            }),
          ],
          '/kb/workspaces/acme/members/2/suspend': () => {
            suspended = true;
          },
        });
      })(),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('佐藤 花子');
    await userEvent.click(canvas.getByRole('button', { name: '佐藤 花子 を停止する' }));
    await waitFor(async () => {
      await expect(canvas.getByText('停止中')).toBeInTheDocument();
    });
    await expect(canvas.getByRole('button', { name: '佐藤 花子 を復帰させる' })).toBeInTheDocument();
  },
};

/** 削除は確認ダイアログを挟む。取り消せば何も起きない。モーダルは document.body へポータルされる。 */
export const 削除は確認してから: Story = {
  decorators: [withApi(baseApi())],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('佐藤 花子');
    await userEvent.click(canvas.getByRole('button', { name: '佐藤 花子 をワークスペースから外す' }));

    const dialog = await screen.findByRole('dialog', { name: 'メンバーを外しますか？' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'キャンセル' }));
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    // キャンセルしたので本人はまだ一覧に残っている。
    await expect(canvas.getByText('佐藤 花子')).toBeInTheDocument();
  },
};

/** 409（最後の admin 等）が返ったら、トーストで理由を知らせるだけで行は変わらない。 */
export const 競合したら理由をトーストで知らせる: Story = {
  decorators: [
    withApi(
      baseApi({
        '/kb/workspaces/acme/members/2/suspend': stubError(409, 'last_workspace_admin'),
      }),
    ),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('佐藤 花子');
    await userEvent.click(canvas.getByRole('button', { name: '佐藤 花子 を停止する' }));

    await waitFor(async () => {
      await expect(
        screen.getByText('最後の admin は外せません。先に他の誰かを admin にしてください。'),
      ).toBeInTheDocument();
    });
    // 失敗したので、佐藤花子は「有効」のまま（一覧を引き直しても状態は変わらない）。
    await expect(canvas.queryAllByText('停止中')).toHaveLength(0);
  },
};

// ---------------------------------------------------------------------------
// email 宛の招待（発行・一覧・再送・取消）
// ---------------------------------------------------------------------------

const invitation = (over: Partial<KbInvitation> = {}): KbInvitation => ({
  id: 'inv-1',
  scope: 'workspace',
  role: 'editor',
  email: 'taro@example.com',
  inviteeName: '山田 太郎',
  status: 'pending',
  workspaceSlug: 'acme',
  workspaceName: 'Acme 社',
  invitedByUserId: 1,
  inviterName: '田中 太郎',
  expiresAt: '2026-09-30T00:00:00Z',
  lastSentAt: '2026-09-23T00:00:00Z',
  sendCount: 1,
  createdAt: '2026-09-23T00:00:00Z',
  ...over,
});

/**
 * 招待 API の見本。一覧は rows を返し、発行・取消は rows を書き換える（成功後に引き直す
 * 画面の動きが見本でも再現される）。突き合わせは前から順なので、細かい宛先を先に書く。
 */
function invitationApi(rows: KbInvitation[]): ApiStubs {
  const state = { rows };
  return {
    '/kb/workspaces/acme/invitations/inv-1/resend': () => ({
      invitation: invitation({ sendCount: 2, lastSentAt: '2026-09-23T01:00:00Z' }),
      token: 'resent-token-xyz',
    }),
    '/kb/workspaces/acme/invitations/inv-1': () => {
      state.rows = state.rows.map((row) => (row.id === 'inv-1' ? { ...row, status: 'revoked', revokedAt: '2026-09-23T02:00:00Z' } : row));
      return undefined;
    },
    '/kb/workspaces/acme/invitations': (config: { method?: string; data?: unknown }) => {
      if (config.method === 'post') {
        const body = JSON.parse(String(config.data)) as { email: string; name?: string; role: string };
        const created = invitation({ id: 'inv-new', email: body.email.trim().toLowerCase(), inviteeName: body.name ?? '', role: body.role as KbInvitation['role'] });
        state.rows = [created, ...state.rows];
        return { invitation: created, token: 'fresh-token-abc' };
      }
      return state.rows;
    },
  };
}

/** 「メンバーを招く」で email を入れると招待ができ、リンクがこの場でだけ出る。 */
export const 招待を作ってリンクを受け取る: Story = {
  decorators: [withApi({ ...invitationApi([]), ...baseApi() })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(async () => {
      await expect(canvas.getByText('承諾待ちの招待はありません。')).toBeInTheDocument();
    });
    await userEvent.click(canvas.getByRole('button', { name: 'メンバーを招く' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'メールアドレス' }), ' Hanako@Example.com ');
    await userEvent.type(within(dialog).getByRole('textbox', { name: /名前/ }), '佐藤 花子');
    await userEvent.selectOptions(within(dialog).getByRole('combobox', { name: '役割' }), 'viewer');
    await userEvent.click(within(dialog).getByRole('button', { name: '招待を作る' }));

    await expect(await screen.findByRole('heading', { name: 'hanako@example.com 宛の招待リンクを作りました' })).toBeVisible();
    await expect(screen.getByRole('textbox', { name: '招待リンク' })).toHaveDisplayValue(/\/invite#t=fresh-token-abc$/);
    await expect(screen.getByRole('note')).toHaveTextContent('閉じると表示できません');
    // 閉じると一覧に承諾待ちとして並ぶ（リンクは二度と出ない）。
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));
    await waitFor(async () => {
      await expect(canvas.getByRole('table', { name: '承諾待ちの招待' })).toBeVisible();
    });
    await expect(canvas.getByText('hanako@example.com')).toBeVisible();
    await expect(canvas.getByText('承諾待ち')).toBeVisible();
  },
};

/** 承諾待ちと期限切れは表に、結果が出たものは畳んだ「過去の招待」に。再送で新しいリンクが出て、取消で表から消える。 */
export const 招待の一覧と再送と取消: Story = {
  decorators: [
    withApi({
      ...invitationApi([
        invitation(),
        invitation({ id: 'inv-2', email: 'ops-lead@example.co.jp', inviteeName: '', role: 'viewer', status: 'expired', expiresAt: '2026-09-14T00:00:00Z' }),
        invitation({ id: 'inv-3', email: 'done@example.com', status: 'accepted', acceptedAt: '2026-09-20T00:00:00Z' }),
      ]),
      ...baseApi(),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = await canvas.findByRole('table', { name: '承諾待ちの招待' });
    await expect(within(table).getByText('taro@example.com')).toBeVisible();
    await expect(within(table).getByText('期限切れ')).toBeVisible();
    await expect(within(table).queryByText('done@example.com')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: '過去の招待（1件）' }));
    await expect(canvas.getByText('done@example.com')).toBeVisible();

    // 再送: 新しいリンクだけがダイアログに出る（「もう 1 人招く」は出ない）。
    const rows = within(table).getAllByRole('row');
    await userEvent.click(within(rows[1]).getByRole('button', { name: '再送' }));
    await expect(await screen.findByRole('textbox', { name: '招待リンク' })).toHaveDisplayValue(/resent-token-xyz$/);
    await expect(screen.queryByRole('button', { name: 'もう 1 人招く' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));

    // 取消: 確認を経て表から消え、過去の招待へ移る。
    await userEvent.click(within(rows[1]).getByRole('button', { name: '取り消す' }));
    await userEvent.click(await screen.findByRole('button', { name: '取り消す' }));
    await waitFor(async () => {
      await expect(within(canvas.getByRole('table', { name: '承諾待ちの招待' })).queryByText('taro@example.com')).not.toBeInTheDocument();
    });
    await expect(canvas.getByRole('button', { name: '過去の招待（2件）' })).toBeVisible();
  },
};

/** 上限や間隔で断られたときは、理由をダイアログの中に出す（閉じない）。 */
export const 同じ宛先に続けて送ると断られる: Story = {
  decorators: [
    withApi({
      '/kb/workspaces/acme/invitations': (config: { method?: string; data?: unknown }) => {
        if (config.method === 'post') return stubError(429, 'resend_too_soon')();
        return [invitation()];
      },
      ...baseApi(),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByRole('table', { name: '承諾待ちの招待' });
    await userEvent.click(canvas.getByRole('button', { name: 'メンバーを招く' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'メールアドレス' }), 'taro@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: '招待を作る' }));
    await expect(await within(dialog).findByRole('alert')).toHaveTextContent('10 分以内に送っています');
    await expect(within(dialog).getByRole('textbox', { name: 'メールアドレス' })).toHaveValue('taro@example.com');
  },
};

/** メールアドレスの形が違うときは、欄の下に出す。 */
export const メールアドレスの形が違う: Story = {
  decorators: [
    withApi({
      '/kb/workspaces/acme/invitations': (config: { method?: string; data?: unknown }) => {
        if (config.method === 'post') return stubError(400, 'invalid_request')();
        return [];
      },
      ...baseApi(),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText('承諾待ちの招待はありません。');
    await userEvent.click(canvas.getByRole('button', { name: 'メンバーを招く' }));
    const dialog = await screen.findByRole('dialog');
    const email = within(dialog).getByRole('textbox', { name: 'メールアドレス' });
    await userEvent.type(email, 'taro');
    await userEvent.click(within(dialog).getByRole('button', { name: '招待を作る' }));
    await waitFor(async () => {
      await expect(email).toHaveAttribute('aria-invalid', 'true');
    });
    await expect(within(dialog).getByText(/メールアドレスの形式を確認してください/)).toBeVisible();
  },
};
