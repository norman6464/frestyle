import type { KbSearchResult } from '@/entities/kb';
import { splitExcerptMatch } from '../lib/highlightExcerpt';
import KbPageGlyph from './KbPageGlyph';

export interface KbSearchResultRowProps {
  page: KbSearchResult;
  /** listbox の option 要素の id（aria-activedescendant から参照される）。 */
  id: string;
  selected: boolean;
  onSelect: () => void;
}

/**
 * KbSearchResultRow は検索結果 1 行（KbSearchDialog の listbox option）。
 *
 * matchField === "title" のとき（従来通り）は題名だけの行。"body" のときは題名の下に
 * 抜粋を小さく添え、一致箇所を `<mark>` で強調する。
 *
 * 抜粋の描画は dangerouslySetInnerHTML を使わない。excerpt を「一致前・一致・一致後」の
 * 3 つに分け（splitExcerptMatch）、それぞれを別々の React ノードとして描画する —
 * これにより excerpt に `<` `>` `&` 等の HTML として解釈され得る文字が含まれていても、
 * React が通常の文字列として扱う（HTML として解釈しない）ので安全になる。
 */
export default function KbSearchResultRow({ page, id, selected, onSelect }: KbSearchResultRowProps) {
  const excerpt = page.matchField === 'body' ? page.excerpt : undefined;
  const segments =
    typeof excerpt === 'string'
      ? splitExcerptMatch(excerpt, page.matchStart ?? 0, page.matchLen ?? 0)
      : null;

  return (
    // 押されるのは option である div 自身（KbSearchDialog の約束 — option の中に
    // 押せるものを入れ子にしない。listbox の中で role="option" として扱われる）。
    <div
      id={id}
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={`flex w-full min-w-0 cursor-pointer items-start gap-1.5 rounded-md px-2 py-1.5 text-left text-sm ${
        selected
          ? 'bg-[var(--color-nav-selected)] text-[var(--color-nav-selected-text)] shadow-[inset_3px_0_0_var(--color-nav-selected-rule)]'
          : 'text-[var(--color-text-primary)] hover:bg-surface-2'
      }`}
    >
      <KbPageGlyph page={page} className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
      <div className="min-w-0 flex-1">
        <span className="block truncate">{page.title}</span>
        {segments && (
          <span className="mt-0.5 block truncate text-xs font-normal text-[var(--color-text-muted)]">
            {segments.before}
            {segments.match !== '' && (
              <mark className="rounded-sm bg-brand-500/20 text-[var(--color-text-primary)]">
                {segments.match}
              </mark>
            )}
            {segments.after}
          </span>
        )}
      </div>
    </div>
  );
}
