import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { AxiosError } from 'axios';
import type { KbInvitation } from '@/entities/kb';
import KbInvitationsPage from './KbInvitationsPage';
import { routerWithParam, withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';

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
    ...over,
    // 見出しに出すワークスペース名。突き合わせは前から順の部分一致なので、これは他の
    // /kb/workspaces/... をすべて飲み込む。必ず最後に置く。
    '/kb/workspaces': [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-01-01T00:00:00Z', canManage: true }],
  };
}

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
      mailStatus: 'sent',
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
        return { invitation: created, token: 'fresh-token-abc', mailStatus: 'sent' };
      }
      return state.rows;
    },
  };
}

const meta = {
  title: 'pages/kb-invitations/KbInvitationsPage',
  component: KbInvitationsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withToast, routerWithParam('/kb/:workspaceSlug/invitations', '/kb/acme/invitations')],
} satisfies Meta<typeof KbInvitationsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 招待がまだ無い状態。見出しとタブが出て、「メンバーを招く」から始められる。 */
export const 招待がまだない: Story = {
  decorators: [withApi({ ...invitationApi([]), ...baseApi() })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'メンバーと招待' })).toBeVisible();
    await expect(canvas.getByText('ワークスペース · Acme 社')).toBeVisible();
    await expect(canvas.getByRole('link', { name: 'メンバー' })).toHaveAttribute('href', '/kb/acme/members');
    await expect(canvas.getByRole('link', { name: '招待' })).toHaveAttribute('aria-current', 'page');
    await waitFor(async () => {
      await expect(canvas.getByText('承諾待ちの招待はありません。')).toBeInTheDocument();
    });
  },
};

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

    await expect(await screen.findByRole('heading', { name: 'hanako@example.com に招待を送りました' })).toBeVisible();
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
    // 書き込みのあとは一覧を引き直す（その間は Loading に差し替わる）ので、表も行も
    // 掴んだままにせず操作の直前に引き直す。前の DOM を押しても何も起きない。
    const rowOf = async (email: string): Promise<HTMLElement> => {
      const table = await canvas.findByRole('table', { name: '承諾待ちの招待' });
      const row = within(table)
        .getAllByRole('row')
        .find((candidate) => within(candidate).queryByText(email) !== null);
      if (!row) throw new Error(`承諾待ちの招待に ${email} の行が無い`);
      return row;
    };

    const table = await canvas.findByRole('table', { name: '承諾待ちの招待' });
    await expect(within(table).getByText('taro@example.com')).toBeVisible();
    await expect(within(table).getByText('期限切れ')).toBeVisible();
    await expect(within(table).queryByText('done@example.com')).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: '過去の招待（1件）' }));
    await expect(canvas.getByText('done@example.com')).toBeVisible();

    // 再送: 新しいリンクだけがダイアログに出る（「もう 1 人招く」は出ない）。
    await userEvent.click(within(await rowOf('taro@example.com')).getByRole('button', { name: '再送' }));
    await expect(await screen.findByRole('textbox', { name: '招待リンク' })).toHaveDisplayValue(/resent-token-xyz$/);
    await expect(screen.queryByRole('button', { name: 'もう 1 人招く' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '閉じる' }));

    // 取消: 確認を経て表から消え、過去の招待へ移る。
    await userEvent.click(within(await rowOf('taro@example.com')).getByRole('button', { name: '取り消す' }));
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

/** メールを送れなかった。招待はできているので、リンクを渡すか再送する案内を出す。 */
export const メールを送れなかった: Story = {
  decorators: [
    withApi({
      '/kb/workspaces/acme/invitations': (config: { method?: string }) => {
        if (config.method === 'post') return { invitation: invitation({ id: 'inv-new' }), token: 'fresh-token-abc', mailStatus: 'failed' };
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
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'メールアドレス' }), 'taro@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: '招待を作る' }));
    await expect(await screen.findByRole('heading', { name: 'taro@example.com 宛の招待リンクを作りました' })).toBeVisible();
    await expect(screen.getByRole('alert')).toHaveTextContent('メールを送れませんでした');
    await expect(screen.getByRole('textbox', { name: '招待リンク' })).toHaveDisplayValue(/fresh-token-abc$/);
  },
};

/** メールを送らない運用（backend が mailStatus を返さない、または disabled）。従来の文言。 */
export const メールを送らない運用: Story = {
  decorators: [
    withApi({
      '/kb/workspaces/acme/invitations': (config: { method?: string }) => {
        if (config.method === 'post') return { invitation: invitation({ id: 'inv-new' }), token: 'fresh-token-abc' };
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
    await userEvent.type(within(dialog).getByRole('textbox', { name: 'メールアドレス' }), 'taro@example.com');
    await userEvent.click(within(dialog).getByRole('button', { name: '招待を作る' }));
    await expect(await screen.findByRole('heading', { name: 'taro@example.com 宛の招待リンクを作りました' })).toBeVisible();
    await expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  },
};

/** admin 以外。権限操作 API の 404（実在を教えない）を「開けない」として受け、画面ごと差し替える。 */
export const admin以外は開けない: Story = {
  decorators: [
    withApi({
      '/kb/workspaces/acme/invitations': stubError(404, 'not_found'),
      ...baseApi(),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(
      await canvas.findByRole('heading', { level: 1, name: 'この画面は admin だけが開けます' }),
    ).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'メンバーを招く' })).not.toBeInTheDocument();
  },
};
