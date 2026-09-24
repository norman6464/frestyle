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
  workspaceSlug: 'frestyle',
  workspaceName: 'FreStyle',
  invitedByUserId: 1,
  inviterName: '鈴木 花子',
  expiresAt: '2026-09-30T00:00:00Z',
  lastSentAt: '2026-09-18T00:30:00Z',
  sendCount: 1,
  createdAt: '2026-09-18T00:30:00Z',
  ...over,
});

const second = invitation({
  id: 'inv-2',
  workspaceSlug: 'product-lab',
  workspaceName: 'プロダクト研究室',
  inviterName: '佐藤 健',
  lastSentAt: '2026-09-17T07:45:00Z',
  expiresAt: '2026-10-02T00:00:00Z',
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
  const remove = (id: string) => {
    state.rows = state.rows.filter((row) => (row as { id: string }).id !== id);
  };
  return {
    '/kb/invitations/inv-1/accept': () => {
      remove('inv-1');
      return { workspaceSlug: 'frestyle', scope: 'workspace' };
    },
    '/kb/invitations/inv-2/accept': () => {
      remove('inv-2');
      return { workspaceSlug: 'product-lab', scope: 'workspace' };
    },
    '/kb/invitations/inv-2/decline': () => {
      remove('inv-2');
      return undefined;
    },
    '/kb/invitations': () => state.rows,
  };
}

/**
 * あなたへの招待（/invitations。設計ボード ST15・ST17・ST18・ST22）。自分（確認済み email）宛の
 * 未決だけが並ぶ。通知とアカウントメニューの飛び先で、招待リンクからログインした後の戻り先でもある。
 */
const meta = {
  title: 'pages/invitations/InvitationsPage',
  component: InvitationsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [withRouter, withToast],
} satisfies Meta<typeof InvitationsPage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 2 件届いている（ST15）。見出し・件数・参加後の役割・参加する → 辞退する の順。 */
export const 届いている: Story = {
  decorators: [withApi(api([invitation(), second]))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole('heading', { level: 1, name: 'あなたへの招待' })).toBeVisible();
    const list = await canvas.findByRole('list', { name: '未対応の招待' });
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    await expect(canvas.getByText('2件')).toBeVisible();
    const first = within(list).getAllByRole('article')[0];
    await expect(within(first).getByRole('heading', { level: 3, name: 'FreStyle' })).toBeVisible();
    await expect(within(first).getByText('参加後の役割')).toBeVisible();
    await expect(within(first).getByText('編集者')).toBeVisible();
    const buttons = within(first).getAllByRole('button').map((b) => b.textContent);
    await expect(buttons).toEqual(['参加する', '辞退する']);
  },
};

/** 参加しても自動では移らない。完了のカード（ST17）が上に出て、見出しへフォーカスが移る。 */
export const 参加すると完了のカードが出る: Story = {
  decorators: [withApi(api([invitation(), second]))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = await canvas.findByRole('list', { name: '未対応の招待' });
    await userEvent.click(within(within(list).getAllByRole('article')[0]).getByRole('button', { name: '参加する' }));
    const heading = await canvas.findByRole('heading', { level: 2, name: 'FreStyle に参加しました' });
    await waitFor(async () => {
      await expect(heading).toHaveFocus();
    });
    await expect(canvas.getByText('編集者として利用できます。')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'ワークスペースを開く' })).toBeVisible();
    // 残りの招待にはそのまま応答できる。
    await expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    await expect(canvas.getByText('1件')).toBeVisible();
  },
};

/** 続けてもう 1 件参加しても、押したボタンは消えるので、新しい完了カードの見出しへフォーカスが移る。 */
export const 続けて参加しても見出しへ移る: Story = {
  decorators: [withApi(api([invitation(), second]))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = await canvas.findByRole('list', { name: '未対応の招待' });
    await userEvent.click(within(within(list).getAllByRole('article')[0]).getByRole('button', { name: '参加する' }));
    await canvas.findByRole('heading', { level: 2, name: 'FreStyle に参加しました' });
    await userEvent.click(await canvas.findByRole('button', { name: '参加する' }));
    const heading = await canvas.findByRole('heading', { level: 2, name: 'プロダクト研究室 に参加しました' });
    await waitFor(async () => {
      await expect(heading).toHaveFocus();
    });
  },
};

/**
 * 辞退は確認を挟む（ST22）。何を辞退するかを枠で見せ、「戻る」なら何も起きない。辞退したら
 * 一覧から消え、結果を知らせ、一覧の見出しへフォーカスを戻す。
 */
export const 辞退は確認してから: Story = {
  decorators: [withApi(api([invitation(), second]))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const list = await canvas.findByRole('list', { name: '未対応の招待' });
    const target = within(list).getAllByRole('article')[1];
    await userEvent.click(within(target).getByRole('button', { name: '辞退する' }));
    let dialog = await screen.findByRole('dialog', { name: 'この招待を辞退しますか？' });
    await expect(within(dialog).getByText('プロダクト研究室')).toBeVisible();
    await expect(within(dialog).getByText('product-lab')).toBeVisible();
    await userEvent.click(within(dialog).getByRole('button', { name: '戻る' }));
    await waitFor(async () => {
      await expect(screen.queryByRole('dialog')).toBeNull();
    });
    await expect(within(list).getAllByRole('listitem')).toHaveLength(2);

    await userEvent.click(within(target).getByRole('button', { name: '辞退する' }));
    dialog = await screen.findByRole('dialog', { name: 'この招待を辞退しますか？' });
    await userEvent.click(within(dialog).getByRole('button', { name: '招待を辞退する' }));
    await waitFor(async () => {
      await expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    });
    await expect(canvas.getByText('「プロダクト研究室」への招待を辞退しました')).toBeVisible();
    await waitFor(async () => {
      await expect(canvas.getByRole('heading', { level: 2, name: '未対応の招待' })).toHaveFocus();
    });
  },
};

/** 参加しようとしたら使えなくなっていた（ST18「この招待は現在利用できません」）。カードの中に出す。 */
export const 参加できなくなっていた: Story = {
  decorators: [
    withApi({
      '/kb/invitations/inv-1/accept': stubError(409, 'invitation_not_open'),
      '/kb/invitations': [invitation()],
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: '参加する' }));
    const alert = await canvas.findByRole('alert');
    await expect(alert).toHaveTextContent('この招待は現在利用できません');
    await expect(within(alert).getByRole('button', { name: '一覧を更新' })).toBeVisible();
  },
};

/** 何も届いていない（ST18 の 0 件）。次の操作として「ホームへ」。 */
export const 空: Story = {
  decorators: [withApi(api([]))],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { level: 2, name: '新しい招待はありません' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'ホームへ' })).toBeVisible();
  },
};

/** 取得に失敗した（ST18）。0 件と取り違えず、再読み込みを置く。 */
export const 取得に失敗: Story = {
  decorators: [withApi({ '/kb/invitations': stubError(500, 'internal_error') })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { level: 2, name: '招待を取得できませんでした' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '再読み込み' })).toBeVisible();
    await expect(canvas.queryByText('新しい招待はありません')).toBeNull();
  },
};

/** 確認済みの email が無いアカウント。招待を突き合わせる材料が無いので、確認を促す（行き止まりにしない）。 */
export const メールアドレスが未確認: Story = {
  decorators: [withApi({ '/kb/invitations': stubError(403, 'email_not_verified') })],
  play: async ({ canvasElement }) => {
    await expect(
      await within(canvasElement).findByRole('heading', { level: 2, name: 'メールアドレスの確認が必要です' }),
    ).toBeVisible();
  },
};

export const 狭い画面: Story = {
  decorators: [withApi(api([invitation(), second]))],
  globals: { viewport: { value: 'mobile1', isRotated: false } },
};
