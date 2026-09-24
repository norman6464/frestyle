import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, screen, userEvent, waitFor, within } from 'storybook/test';
import { withApi, withStore, withToast } from '../../../../.storybook/decorators';
import { SidebarSection } from '@/shared/ui';
import AppShell from './AppShell';

/**
 * ログイン後の画面ぜんぶを包む外枠（帯・本文・上に戻る・行き先を探す窓）。設計ボード ST02・ST03。
 *
 * 帯は常時表示で、主な行き先（ホーム・担当・ナレッジ・バックログ）・検索・通知・アカウントを持つ。
 * 本文とは縦に並べる（重ねない）。画面が区画を差し込んだとき（ナレッジの木など）だけ、本文の左に
 * 列が出る。それ以外の画面は本文が全幅。
 *
 * ⌘K（Windows は Ctrl+K）でどこからでも「行き先を探す窓」が開く。
 */
/**
 * story の本文。`withSection` のときは左の列への差し込み（画面ごとの区画）も一緒に出す。
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

/** ふだんの見え方。行き先は帯が持ち、区画の無い画面では本文が全幅になる。 */
export const 既定: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const nav = within(canvas.getByRole('banner')).getByRole('navigation', { name: '主な行き先' });
    for (const label of ['ホーム', '担当', 'ナレッジ', 'バックログ']) {
      await expect(within(nav).getByRole('link', { name: label })).toBeVisible();
    }
    await expect(within(nav).getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
    // 広い画面では下部ナビは出ない（同じ行き先を 2 系統並べない）。
    await expect(canvas.getAllByRole('navigation', { name: '主な行き先' })).toHaveLength(1);
    // 区画が無いので、狭い画面用の三本線も出ない。
    await expect(canvas.queryByRole('button', { name: 'サイドメニューを開く' })).toBeNull();
    await expect(canvas.getByRole('heading', { name: 'ここが本文' })).toBeVisible();
  },
};

/**
 * 狭い画面では毎日使う行き先は下部ナビ（設計ボード ST12）が持つ。帯には行き先を出さない。
 */
export const モバイルは下部ナビ: Story = {
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // 帯の行き先は幅で隠れ、名前の同じナビは下部の 1 つだけが読める。
    const [bottom] = canvas.getAllByRole('navigation', { name: '主な行き先' });
    await expect(bottom).toBeVisible();
    await expect(canvas.getAllByRole('navigation', { name: '主な行き先' })).toHaveLength(1);
    for (const label of ['ホーム', '担当', 'ナレッジ', 'バックログ']) {
      await expect(within(bottom).getByRole('link', { name: label })).toBeVisible();
    }
    await expect(within(bottom).getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
    // 画面の下端に張り付く。本文はその分だけ下に余白を取り、最後の行が隠れない。
    const rect = bottom.getBoundingClientRect();
    await expect(Math.round(rect.bottom)).toBe(Math.round(window.innerHeight));
    const main = canvasElement.querySelector('main')!;
    await expect(parseFloat(getComputedStyle(main).paddingBottom)).toBeGreaterThanOrEqual(rect.height);
  },
};

/** 狭い画面で区画のある画面を開くと、三本線で区画を引き出しとして開ける。キーボードだけで開閉できる。 */
export const モバイルのメニューをキーボードで操作: Story = {
  parameters: { withSection: true },
  globals: { viewport: { value: 'mobile1', isRotated: false } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole('button', { name: 'サイドメニューを開く' });
    await userEvent.click(trigger);
    const close = await canvas.findByRole('button', { name: 'メニューを閉じる' });
    await waitFor(() => expect(close).toHaveFocus());
    // 引き出しの中身は画面の区画だけ（行き先は下部ナビが持つ）。
    await expect(within(canvas.getByRole('dialog', { name: 'サイドメニュー' })).getByRole('link', { name: '概要' })).toBeVisible();
    // Shift+Tab は引き出しの最後の項目へ回り、Tab で閉じるボタンへ戻る。
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
    await expect(canvas.getByRole('link', { name: 'アーキテクチャ概要' })).toHaveFocus();
    await userEvent.keyboard('{Tab}');
    await expect(close).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(trigger).toHaveFocus());
    await waitFor(() => expect(canvas.queryByRole('button', { name: 'メニューを閉じる' })).toBeNull());
  },
};

/** ⌘K で「行き先を探す窓」が開く。 */
export const コマンドパレットを開く: Story = {
  play: async () => {
    await userEvent.keyboard('{Meta>}k{/Meta}');
    // 窓は Base UI の Dialog で body 直下（Portal）に描かれるので、描画枠の中ではなく画面全体から探す。
    await waitFor(async () => {
      await expect(screen.getByPlaceholderText('移動先を探す...')).toBeVisible();
    });
    // 開いたら入力欄にフォーカスが移る（すぐ打ち始められる）。
    await waitFor(async () => {
      await expect(screen.getByRole('combobox', { name: '移動先を探す' })).toHaveFocus();
    });
  },
};

/**
 * 画面ごとの区画（ナレッジのスペースと木）は、画面が差し込み口から入れ、本文の左に列が出る
 * （設計ボード ST03: ナレッジを読むときだけ左に木）。
 */
export const 画面の区画が左の列に入る: Story = {
  parameters: { withSection: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = canvas.getByRole('navigation', { name: 'ナレッジ' });
    await expect(section).toBeVisible();
    // 差し込んだ中身は本文（main）の外、その左に出る。
    const main = canvasElement.querySelector('main')!;
    await expect(main.contains(section)).toBe(false);
    await expect(section.getBoundingClientRect().right).toBeLessThanOrEqual(main.getBoundingClientRect().left + 1);
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
