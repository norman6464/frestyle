import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { AxiosError } from 'axios';
import KbMembersPage from './KbMembersPage';
import { routerWithParam, withApi, withToast, type ApiStubs } from '../../../../.storybook/decorators';

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
    // 見出しに出すワークスペース名。突き合わせは前から順の部分一致なので、これは他の
    // /kb/workspaces/... をすべて飲み込む。必ず最後に置く。
    '/kb/workspaces': [{ slug: 'acme', name: 'Acme 社', createdAt: '2026-01-01T00:00:00Z', canManage: true }],
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
