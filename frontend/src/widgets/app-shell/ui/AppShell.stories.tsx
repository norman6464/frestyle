import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withStore, withToast } from '../../../../.storybook/decorators';
import { SidebarSection } from '@/shared/ui';
import AppShell from './AppShell';

/**
 * ログイン後の画面ぜんぶを包む外枠（帯・柱・本文・上に戻る・行き先を探す窓）。
 *
 * 帯は常時表示で、本文とは縦に並べる（重ねない）。その下は横並びで、左に柱 1 本、
 * 右が本文。柱の中身のうち画面ごとの区画は、画面が差し込み口から入れる。
 *
 * ⌘K（Windows は Ctrl+K）でどこからでも「行き先を探す窓」が開き、⌘\ で柱が開閉する。
 */
/**
 * story の本文。`withSection` のときは柱への差し込み（画面ごとの区画）も一緒に出す。
 */
function Body({ withSection }: { withSection: boolean }) {
  return (
    <>
      {withSection && (
        <SidebarSection>
          <nav aria-label="ナレッジ" className="flex flex-col gap-0.5">
            <p className="px-2 py-1.5 text-sm font-semibold text-[var(--color-text-primary)]">開発ナレッジ</p>
            <a href="#a" className="rounded-md px-2 py-1.5 text-sm text-[var(--color-text-tertiary)]">
              概要
            </a>
            <a href="#b" className="rounded-md px-2 py-1.5 text-sm text-[var(--color-text-tertiary)]">
              アーキテクチャ概要
            </a>
          </nav>
        </SidebarSection>
      )}
      <div className="mx-auto max-w-3xl p-6">
        <h1 className="mb-4 text-2xl font-bold text-[var(--color-text-primary)]">ここが本文</h1>
        {Array.from({ length: 30 }, (_, i) => (
          <p key={i} className="py-2 text-sm text-[var(--color-text-secondary)]">
            {i + 1} 行目
          </p>
        ))}
      </div>
    </>
  );
}

const meta = {
  title: 'widgets/app-shell/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
  decorators: [
    withStore(),
    withToast,
    withApi({
      '/profile/me': { displayName: '川野 拓馬', avatarUrl: null, email: 'takuma@example.com' },
      '/notifications/unread-count': 2,
      // 宛先は前方一致で選ばれる。細かいほう（spaces）を先に書かないと、スペースの
      // 問い合わせにワークスペースの配列が返り、柱が別物を並べてしまう。
      '/kb/workspaces/w-3f2a9c/spaces': [
        { id: 'sp-1', workspaceId: 'w-1', name: '設計スペース', createdAt: '', updatedAt: '' },
      ],
      '/kb/workspaces': [
        { slug: 'w-3f2a9c', name: '開発チーム', createdAt: '2026-01-01T00:00:00Z', canManage: true },
      ],
    }),
    // AppShell は「枠」なので、中身は Outlet に入る。router の入れ子まで作らないと描けない
    // （router は 1 つだけ。story ごとに足すと「Router の中に Router」で描けなくなる）。
    (Story, context) => (
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route element={<Story />}>
            <Route index element={<Body withSection={context.parameters.withSection === true} />} />
          </Route>
        </Routes>
      </MemoryRouter>
    ),
  ],
} satisfies Meta<typeof AppShell>;

export default meta;
type Story = StoryObj<typeof meta>;

/** ふだんの見え方。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 行き先は左端の柱が持つ（ヘッダーには無い）。
    await expect(canvas.getByRole('navigation', { name: 'アプリのナビゲーション' })).toBeVisible();
    await expect(canvas.getByRole('heading', { name: 'ここが本文' })).toBeVisible();
  },
};

/** ⌘K で「行き先を探す窓」が開く。 */
export const コマンドパレットを開く: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.keyboard('{Meta>}k{/Meta}');
    await waitFor(async () => {
      await expect(canvas.getByPlaceholderText('コマンドを検索...')).toBeVisible();
    });
  },
};

/**
 * 画面ごとの区画（ナレッジの木・バックログのプロジェクト）は、画面が差し込み口から
 * 柱の中へ入れる。柱は 1 本しか無く、その中に行き先と区画が縦に並ぶ。
 *
 * 差し込むと柱の既定の中身（スペースの一覧）は引っ込む —— 区画のほうが今いる場所を
 * 詳しく出しており、同じものが上下に二重になるため。
 */
export const 画面の区画が柱に入る: Story = {
  parameters: { withSection: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const rail = canvas.getByRole('navigation', { name: 'アプリのナビゲーション' }).closest('div')!.parentElement!;
    // 差し込んだ中身が DOM 上も柱の中にある（本文の中に残っていない）。
    await expect(rail.contains(canvas.getByRole('navigation', { name: 'ナレッジ' }))).toBe(true);
    await expect(canvas.getByRole('heading', { name: 'ここが本文' })).toBeVisible();
  },
};

/** 下へスクロールすると「上に戻る」が右下に出る。 */
export const 上に戻るが出る: Story = {
  play: async ({ canvasElement }) => {
    const main = canvasElement.querySelector('#main-content') as HTMLElement;
    main.scrollTop = 500;
    main.dispatchEvent(new Event('scroll'));
    await waitFor(async () => {
      await expect(
        within(canvasElement).getByRole('button', { name: 'ページ上部に戻る' }),
      ).toBeInTheDocument();
    });
  },
};
