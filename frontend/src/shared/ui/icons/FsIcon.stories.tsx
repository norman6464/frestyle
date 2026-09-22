import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import FsIcon from './FsIcon';
import { FS_ICON_NAMES, type FsIconName } from './fsIconParts';
import FsIllustration, { type FsIllustrationName } from './FsIllustration';

/**
 * FreStyle の線アイコン一式。設計ボード ST02 / ST12 の絵に合わせて自作した。
 *
 * 線幅 1.75・丸い端・24 の格子。heroicons（1.5）より一段太く、小さくしても線が消えない。
 * 状態と優先度は色ではなく形で区別できる。
 */
const meta = {
  title: 'shared/icons/FsIcon',
  component: FsIcon,
  parameters: { layout: 'padded' },
  args: { name: 'home' },
} satisfies Meta<typeof FsIcon>;

export default meta;
type Story = StoryObj<typeof meta>;

const GROUPS: { title: string; names: FsIconName[] }[] = [
  { title: '全体ナビ・殻', names: ['home', 'assigned', 'knowledge', 'backlog', 'bell', 'settings', 'search', 'user', 'logout', 'menu', 'panel'] },
  {
    title: '操作',
    names: [
      'plus', 'x', 'check', 'chevron-down', 'chevron-right', 'chevron-left', 'chevron-up-down', 'chevron-double-down',
      'arrow-right', 'arrow-up', 'arrow-down', 'arrow-up-right', 'filter', 'more', 'trash', 'pencil', 'archive',
      'archive-restore', 'sprint', 'calendar', 'clock', 'tag', 'paperclip', 'comment', 'eye', 'eye-off', 'refresh',
    ],
  },
  { title: '状態（形で区別）', names: ['status-todo', 'status-progress', 'status-done'] },
  { title: '優先度（向きで読む）', names: ['priority-high', 'priority-medium', 'priority-low'] },
  { title: '知らせ', names: ['alert-circle', 'info', 'alert-triangle', 'check-circle', 'inbox'] },
];

/** 全部。名前つきで並べ、欠けや線の乱れを目で確かめる。 */
export const 一覧: Story = {
  render: () => (
    <div className="space-y-8 text-[var(--color-text-primary)]">
      {GROUPS.map((group) => (
        <section key={group.title}>
          <h3 className="mb-3 text-xs font-semibold text-[var(--color-text-muted)]">{group.title}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
            {group.names.map((name) => (
              <li key={name} className="flex flex-col items-center gap-2 rounded-lg border border-surface-3 p-3">
                <FsIcon name={name} className="h-6 w-6" />
                <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{name}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  ),
  play: async ({ canvasElement }) => {
    // 型に列挙した名前と、描いた名前が一致している（漏れなく描いてある）。
    await expect(canvasElement.querySelectorAll('svg[data-icon]')).toHaveLength(FS_ICON_NAMES.length);
  },
};

/** 小さくしても線が消えない。16 / 20 / 24 / 32 で並べる。 */
export const 大きさ: Story = {
  render: () => (
    <div className="flex items-end gap-6 text-[var(--color-text-primary)]">
      {(['h-4 w-4', 'h-5 w-5', 'h-6 w-6', 'h-8 w-8'] as const).map((size) => (
        <div key={size} className="flex flex-col items-center gap-2">
          <div className="flex gap-2">
            <FsIcon name="knowledge" className={size} />
            <FsIcon name="filter" className={size} />
            <FsIcon name="status-progress" className={size} />
            <FsIcon name="priority-high" className={size} />
          </div>
          <span className="font-mono text-[10px] text-[var(--color-text-muted)]">{size}</span>
        </div>
      ))}
    </div>
  ),
};

/** 状態は色を利用者が選ぶので、どの色でも形で読めることを確かめる。 */
export const 状態の形と色: Story = {
  render: () => (
    <div className="flex gap-6">
      {(
        [
          ['status-todo', '#5b6b7a', '未着手'],
          ['status-progress', '#a0661a', '進行中'],
          ['status-done', '#2f6b47', '完了'],
          ['status-progress', '#f5d0c5', '淡い色でも形で読める'],
        ] as const
      ).map(([name, color, label]) => (
        <div key={label} className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
          <FsIcon name={name} className="h-4 w-4" style={{ color }} />
          {label}
        </div>
      ))}
    </div>
  ),
};

/** 意味を持たせるときは title。読み上げに名前が届く。 */
export const 意味を持つ絵: Story = {
  args: { name: 'alert-circle', title: '取得できませんでした', className: 'h-6 w-6 text-danger-ink' },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole('img', { name: '取得できませんでした' })).toBeInTheDocument();
  },
};

const ILLUSTRATIONS: { name: FsIllustrationName; label: string }[] = [
  { name: 'empty-backlog', label: 'まだチケットがありません' },
  { name: 'empty-archive', label: 'アーカイブされたチケットはありません' },
  { name: 'no-results', label: '条件に合うチケットはありません' },
  { name: 'load-error', label: '読み込めませんでした' },
];

/** 空状態・失敗の絵。二色刷りで、差し色は 1 か所だけ。 */
export const 空状態の絵: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-6 text-[var(--color-text-muted)] sm:grid-cols-4">
      {ILLUSTRATIONS.map(({ name, label }) => (
        <div key={name} className="flex flex-col items-center gap-3 rounded-lg border border-surface-3 p-4 text-center">
          <FsIllustration name={name} />
          <span className="text-xs text-[var(--color-text-secondary)]">{label}</span>
        </div>
      ))}
    </div>
  ),
};
