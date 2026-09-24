import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { Decorator } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import InvitePage from './InvitePage';
import { withApi, withRouter } from '../../../../.storybook/decorators';

/**
 * 招待リンク（/invite#t=…）を開いた画面。ログイン前に見られ、ここでは参加できない
 * （参加はログイン後の /invitations）。
 *
 * トークンは URL のフラグメントに載ってくるので、見本でも描く前にフラグメントを置く。
 * 画面はそれを読んだらすぐ URL から消す。
 */
const meta = {
  title: 'pages/invite/InvitePage',
  component: InvitePage,
  parameters: { layout: 'fullscreen' },
  decorators: [withRouter],
} satisfies Meta<typeof InvitePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 描く前に location.hash を置く（画面が読んだあと消すので、story ごとに置き直す）。 */
function withHash(hash: string): Decorator {
  return (Story) => {
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}${hash}`);
    return <Story />;
  };
}

/** ログイン済みの目印 Cookie を置く（画面は Redux ではなくこの目印を見る）。 */
const withSignedInHint: Decorator = (Story) => {
  document.cookie = 'fs_signed_in=1; path=/';
  useEffect(() => () => {
    document.cookie = 'fs_signed_in=; path=/; max-age=0';
  }, []);
  return <Story />;
};

const pendingPreview = {
  status: 'pending',
  workspaceName: 'Acme 社',
  inviterName: '鈴木 花子',
  inviteeName: '山田 太郎',
  email: 'taro@example.com',
  role: 'editor',
  scope: 'workspace',
  expiresAt: '2026-09-30T14:59:59Z',
};

/** 未ログインで開いた。誰から・どこへ・どの役割で・どの宛先へ、が読め、ログインか登録へ進める。 */
export const 未ログインで開いた: Story = {
  decorators: [withHash('#t=story-token'), withApi({ '/kb/invitations/preview': pendingPreview })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'ワークスペースへの招待が届いています' })).toBeVisible();
    await expect(canvas.getByText('鈴木 花子')).toBeVisible();
    await expect(canvas.getAllByText('taro@example.com').length).toBeGreaterThan(0);
    await expect(canvas.getByText('編集者（ページを作り、編集できる）')).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'ログインして参加する' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'アカウントを作る' })).toBeVisible();
    // トークンは読んだあと URL から消えている。
    await expect(window.location.hash).not.toContain('story-token');
  },
};

/** ログイン済みで開いた。届いている招待の一覧へ進める。 */
export const ログイン済みで開いた: Story = {
  decorators: [withSignedInHint, withHash('#t=story-token'), withApi({ '/kb/invitations/preview': pendingPreview })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('button', { name: '招待を確認して参加する' })).toBeVisible();
    await expect(canvas.queryByRole('button', { name: 'ログインして参加する' })).not.toBeInTheDocument();
  },
};

/** 使えない招待（期限切れ・取り消し・使用済み）。理由は出さない。 */
export const 使えない招待: Story = {
  decorators: [withHash('#t=dead-token'), withApi({ '/kb/invitations/preview': { status: 'unavailable' } })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: 'この招待は使えません' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'ログイン画面へ' })).toBeVisible();
  },
};

/** トークンの無い URL で開いた。使えない招待と同じ案内（API は呼ばない）。 */
export const トークンが無い: Story = {
  decorators: [withHash(''), withApi({})],
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('heading', { name: 'この招待は使えません' })).toBeVisible();
  },
};

/** 通信に失敗した。招待が無いのではなく確かめられていない、と伝え、同じトークンで引き直せる。 */
export const 確認に失敗した: Story = {
  decorators: [
    withHash('#t=story-token'),
    withApi({
      // 1 回目は失敗（500）、2 回目から案内が返る。
      '/kb/invitations/preview': (() => {
        let calls = 0;
        return () => {
          calls += 1;
          if (calls === 1) throw new Error('network down');
          return pendingPreview;
        };
      })(),
    }),
  ],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole('heading', { name: '招待を確認できませんでした' })).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'もう一度読み込む' }));
    // URL からトークンを消したあとでも、持っている値で引き直せる。
    await expect(await canvas.findByRole('heading', { name: 'ワークスペースへの招待が届いています' })).toBeVisible();
  },
};

/** 「ログインして参加する」はログイン画面へ送る（戻り先 /invitations を置いてから）。 */
export const ログインへ進む: Story = {
  decorators: [withHash('#t=story-token'), withApi({ '/kb/invitations/preview': pendingPreview })],
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'ログインして参加する' }));
    await waitFor(async () => {
      await expect(sessionStorage.getItem('fs.postLoginPath')).toBe('/invitations');
    });
    sessionStorage.removeItem('fs.postLoginPath');
  },
};
