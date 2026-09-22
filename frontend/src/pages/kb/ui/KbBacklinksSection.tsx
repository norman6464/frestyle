import { useState } from 'react';
import { Link } from 'react-router-dom';
import { KbPageGlyph } from '@/widgets/kb-sidebar';
import type { KbPage } from '@/entities/kb';
import { FsIcon } from '@/shared/ui';

export interface KbBacklinksSectionProps {
  /** このページを参照しているページの一覧。 */
  pages: KbPage[];
  /** 取得中か（useKbBacklinks.loading をそのまま渡す）。 */
  loading: boolean;
}

/**
 * KbBacklinksSection は本文末尾に置く「このページを参照しているページ」の折りたたみ。
 *
 * **0 件（取得済み）ならセクション自体を出さない。** 「参照されていません」のような
 * 空状態メッセージはノイズになるだけ、という画面設計の判断 — ほとんどのページは
 * 参照されないまま存在し得るので、それをいちいち告げる価値が無い。
 *
 * 取得中（loading）だけは最小限のローディング表示を出す。0 件と決まる前に何も出さないと、
 * 「読み込みが終わって 0 件だった」のか「まだ数えている」のかが画面から見分けられない。
 *
 * 開閉状態はこのコンポーネント自身の state（KbPage 側が pageId ごとに作り直すので、
 * ページ遷移をまたいでは保持されない — 毎回閉じた状態から始まる、という画面設計の約束）。
 * 件数は閉じていても見出しに出す。
 */
export default function KbBacklinksSection({ pages, loading }: KbBacklinksSectionProps) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <p className="mt-12 border-t border-surface-3 pt-4 text-xs text-[var(--color-text-muted)]">
        参照しているページを確認しています…
      </p>
    );
  }

  if (pages.length === 0) return null;

  return (
    <div className="mt-12 border-t border-surface-3 pt-4">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs font-medium text-[var(--color-text-secondary)] transition-colors hover:text-[var(--color-text-primary)]"
      >
        <FsIcon name="chevron-right" className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        このページを参照しているページ（{pages.length}）
      </button>
      {open && (
        <ul className="mt-2 space-y-0.5">
          {pages.map((page) => (
            <li key={page.id}>
              <Link
                to={`/kb/${page.id}`}
                className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm text-[var(--color-text-primary)] hover:bg-surface-2"
              >
                <KbPageGlyph page={page} className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                <span className="truncate">{page.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
