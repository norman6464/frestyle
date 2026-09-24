import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import KbWorkspaceSwitcher from './KbWorkspaceSwitcher';
import type { KbWorkspace } from '../model/types';

/**
 * ナレッジの文脈バーの先頭にある、ワークスペースの切り替え（設計ボード ST03 の「FreStyle ▾」）。
 *
 * **同時に見えるのは 1 つだけ**にしてある。ワークスペースは会社の境目なので、
 * 2 社ぶんを並べて見る場面が無く、並べると「いまどちらを触っているか」が曖昧になるため。
 *
 * 一覧は ARIA の役割を名乗らない素のボタンの並びにしてある。listbox や menu を名乗ると
 * 矢印キーでの移動を約束したことになるが、それを実装していない — 名乗りと実際が食い違うと、
 * 読み上げソフトを使う人だけが「動かない操作」を教えられることになる。
 *
 * ワークスペース単位の入口（メンバーと招待・追加）もここに集める。削除はここには置かない。
 */
const meta = {
  title: 'entities/kb/KbWorkspaceSwitcher',
  component: KbWorkspaceSwitcher,
  parameters: { layout: 'padded' },
  args: { onSelect: fn(), onCreate: fn(async () => {}) },
  decorators: [
    (Story) => (
      // 実物は文脈バーの中。開いた一覧が入る高さを確保する。
      <div className="h-96 w-80 bg-surface p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof KbWorkspaceSwitcher>;

export default meta;
type Story = StoryObj<typeof meta>;

const workspaces: KbWorkspace[] = [
  { slug: 'w-3f2a9c', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true },
  { slug: 'w-88ab21', name: '営業部', createdAt: '2026-02-01T00:00:00Z', canManage: false },
  { slug: 'w-10cc45', name: '個人メモ', createdAt: '2026-03-01T00:00:00Z', canManage: true },
];

/** 閉じているとき。いま選んでいるものの名前だけが見える。 */
export const 閉じている: Story = {
  args: { workspaces, activeSlug: 'w-3f2a9c' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('button', { name: /開発チーム/ })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  },
};

/** まだどれも選んでいないとき。 */
export const 未選択: Story = {
  args: { workspaces, activeSlug: null },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByText('ワークスペースを選択')).toBeVisible();
  },
};

/** 開いたところ。いま選んでいるものにレ点が付く。 */
export const 開いたところ: Story = {
  args: { workspaces, activeSlug: 'w-3f2a9c' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /開発チーム/ }));
    await expect(canvas.getByRole('list', { name: 'ワークスペース' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: '営業部' })).toBeVisible();
  },
};

/** 別のものを選ぶと、その slug が親へ渡って一覧は閉じる。 */
export const 切り替える: Story = {
  args: { workspaces, activeSlug: 'w-3f2a9c' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /開発チーム/ }));
    await userEvent.click(canvas.getByRole('button', { name: '営業部' }));
    await expect(args.onSelect).toHaveBeenCalledWith('w-88ab21');
    await expect(canvas.queryByRole('list', { name: 'ワークスペース' })).toBeNull();
  },
};

/**
 * 「ワークスペースを追加」から作る。
 *
 * この入口をここに置いてあるのが要点。無いと、1 つ作った時点で新しく作る手段が
 * 画面から消える（スペース側で実際に踏んだ）。
 */
export const 追加する: Story = {
  args: { workspaces, activeSlug: 'w-3f2a9c' },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /開発チーム/ }));
    await userEvent.click(canvas.getByRole('button', { name: 'ワークスペースを追加' }));
    await userEvent.type(canvas.getByLabelText('ワークスペースの名前'), '新しいチーム');
    await userEvent.click(canvas.getByRole('button', { name: 'ワークスペースを作る' }));
    await expect(args.onCreate).toHaveBeenCalledWith({ name: '新しいチーム' });
  },
};

/** まだ 1 つも無いとき。 */
export const 空: Story = {
  args: { workspaces: [], activeSlug: null },
};

/**
 * 今いるワークスペースを管理できるときは、一覧の下に「メンバーと招待」が出る。
 * 削除はここには置かない（選ぶ操作の隣に戻せない操作を並べない。メンバーと招待の画面の下にある）。
 */
export const メンバーと招待への入口: Story = {
  args: { workspaces, activeSlug: 'w-3f2a9c', onManageMembers: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'ワークスペース「開発チーム」を切り替える' }));
    await expect(canvas.queryByRole('button', { name: /を削除/ })).toBeNull();
    await userEvent.click(canvas.getByRole('button', { name: 'メンバーと招待' }));
    await expect(args.onManageMembers).toHaveBeenCalledWith('w-3f2a9c');
  },
};

/** 管理できないワークスペース（営業部）にいるときは、メンバーと招待の入口を出さない。 */
export const 管理できないときは入口を出さない: Story = {
  args: { workspaces, activeSlug: 'w-88ab21', onManageMembers: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'ワークスペース「営業部」を切り替える' }));
    await expect(canvas.getByRole('button', { name: '営業部' })).toHaveAttribute('aria-current', 'true');
    await expect(canvas.queryByRole('button', { name: 'メンバーと招待' })).toBeNull();
  },
};
