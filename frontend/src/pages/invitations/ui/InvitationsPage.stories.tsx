import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { AxiosError } from 'axios';
import InvitationsPage from './InvitationsPage';
import { withApi, withRouter, withToast, type ApiStubs } from '../../../../.storybook/decorators';

const invitation = (over: Record<string, unknown> = {}) => ({
  id: 'inv-1',
  scope: 'workspace',
  role: 'editor',
  email: 'taro@example.com',
  inviteeName: '山田 太郎',
  status: 'pending',
  workspaceSlug: 'acme',
  workspaceName: 'Acme 社',
  invitedByUserId: 1,
  inviterName: '鈴木 花子',
  expiresAt: '2026-09-30T00:00:00Z',
  lastSentAt: '2026-09-23T00:00:00Z',
  sendCount: 1,
  createdAt: '2026-09-23T00:00:00Z',
  ...over,
});

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

/** 承諾・辞退は細かい宛先なので先に書く（`/kb/invitations` が先だと一覧が返ってしまう）。 */
function api(rows: unknown[]): ApiStubs {
  const state = { rows };
  return {
    '/kb/invitations/inv-1/accept': { workspaceSlug: 'acme', scope: 'workspace' },
    '/kb/invitations/inv-2/decline': () => {
      state.rows = state.rows.filter((row) => (row as { id: string }).id !== 'inv-2');
      return undefined;
    },
    '/kb/invitations': () => state.rows,
  };
}

/**
 * 届いている招待（/invitations）。自分（確認済み email）宛の未決だけが並び、参加すると
 * そのワークスペースへ移る。通知の飛び先で、招待リンクからログインした後の戻り先でもある。
 */
const meta = {
  title: 'pages/invitations/InvitationsPage',
  component: InvitationsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withRouter, withToast],
} satisfies Meta<typeof InvitationsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 2 件届いている。参加するとその場で知らせが出て移動し、辞退すると一覧から消える。 */
export const 届いている: Story = {
  decorators: [withApi(api([invitation(), invitation({ id: 'inv-2', workspaceSlug: 'dev', workspaceName: '開発チーム', inviterName: '佐藤 健', role: 'viewer', expiresAt: '2026-10-02T00:00:00Z' })]))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = await canvas.findByRole('list', { name: '届いている招待' });
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await expect(canvas.getByText(/鈴木 花子 さんから/)).toBeVisible();

    const second = within(list).getAllByRole('listitem')[1];
    await userEvent.click(within(second).getByRole('button', { name: '辞退する' }));
    await waitFor(async () => {
      await expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    });

    await userEvent.click(within(list).getByRole('button', { name: '参加する' }));
    // トーストは出た直後に薄い状態から始まるので、見えることではなく出たことを確かめる。
    await expect(await screen.findByText('Acme 社 に参加しました')).toBeInTheDocument();
  },
};

/** 何も届いていない。 */
export const 空: Story = {
  decorators: [withApi(api([]))],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByText('届いている招待はありません')).toBeVisible();
  },
};

/** 確認済みの email が無いアカウント。招待を突き合わせる材料が無いので、確認を促す。 */
export const メールアドレスが未確認: Story = {
  decorators: [withApi({ '/kb/invitations': stubError(403, 'email_not_verified') })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText('メールアドレスの確認が必要です')).toBeVisible();
    await expect(canvas.getByRole('button', { name: '設定を開く' })).toBeVisible();
  },
};

/** 承諾しようとしたら、もう使えなくなっていた（期限切れ・取り消し）。知らせて引き直す。 */
export const 承諾できなくなっていた: Story = {
  decorators: [
    withApi({
      '/kb/invitations/inv-1/accept': stubError(409, 'invitation_not_open'),
      '/kb/invitations': [invitation()],
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '参加する' }));
    await expect(await screen.findByText(/この招待はもう使えません/)).toBeInTheDocument();
  },
};
