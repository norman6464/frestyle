import { useEffect, useState } from 'react';
import type { DocHeading } from '../lib/docOutline';

export interface KbTocPanelProps {
  headings: DocHeading[];
  /** 本文（RichTextEditor を含む記事）の DOM。見出しの飛び先と、今読んでいる段の判定に使う。 */
  articleRef: React.RefObject<HTMLElement | null>;
}

/** 本文の中の、この見出しに当たる DOM 要素を探す。id で引けなければ何番目かで引く。 */
function findHeadingElement(article: HTMLElement, heading: DocHeading): HTMLElement | null {
  if (heading.id) {
    const byId = article.querySelector<HTMLElement>(`[data-block-id="${heading.id}"]`);
    if (byId) return byId;
  }
  const all = article.querySelectorAll<HTMLElement>('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3');
  return all[heading.index] ?? null;
}

/**
 * KbTocPanel は右レールの「目次」。本文の見出し（1〜3 段）を並べ、押すとそこへ移る。
 *
 * 目次は本文（doc）から作るので、書きながら見出しを足せばその場で増える。今読んでいる段の
 * 強調は、本文のスクロールに合わせて「画面の上端を過ぎた最後の見出し」を選ぶ。
 * IntersectionObserver の無い環境（単体テスト）では強調を出さないだけで、飛ぶ動きは変わらない。
 */
export default function KbTocPanel({ headings, articleRef }: KbTocPanelProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  useEffect(() => {
    const article = articleRef.current;
    if (!article || headings.length === 0 || typeof IntersectionObserver === 'undefined') {
      setActiveIndex(null);
      return;
    }
    const elements = headings
      .map((heading) => findHeadingElement(article, heading))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;
    // スクロールの入れ物は本文の <main>。無ければ画面（story など）を基準にする。
    const root = article.closest('main');
    const observer = new IntersectionObserver(
      () => {
        // 見えている・上へ過ぎた見出しのうち、いちばん下の物を「今読んでいる段」とする。
        const rootTop = root ? root.getBoundingClientRect().top : 0;
        let current: number | null = null;
        elements.forEach((el, i) => {
          if (el.getBoundingClientRect().top - rootTop <= 96) current = i;
        });
        setActiveIndex(current);
      },
      { root, rootMargin: '-96px 0px 0px 0px', threshold: [0, 1] },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [headings, articleRef]);

  if (headings.length === 0) {
    return (
      <p className="px-4 py-6 text-sm leading-relaxed text-[var(--color-text-muted)]">
        見出しがありません。本文に見出しを付けると、ここから飛べます。
      </p>
    );
  }

  const minLevel = Math.min(...headings.map((heading) => heading.level));

  return (
    <nav aria-label="目次" className="flex flex-col gap-0.5 p-3">
      {headings.map((heading) => {
        const active = activeIndex === heading.index;
        const sub = heading.level > minLevel;
        return (
          <button
            key={`${heading.index}-${heading.id ?? ''}`}
            type="button"
            aria-current={active ? 'location' : undefined}
            onClick={() => {
              const article = articleRef.current;
              if (!article) return;
              findHeadingElement(article, heading)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}
            className={`block w-full rounded-md py-1.5 text-left text-sm transition-colors [overflow-wrap:anywhere] ${
              sub ? 'pl-6 pr-2' : 'px-2'
            } ${
              active
                ? 'bg-[var(--color-nav-selected)] font-semibold text-[var(--color-nav-selected-text)] shadow-[inset_2px_0_0_var(--color-nav-selected-rule)]'
                : sub
                  ? 'text-[var(--color-text-muted)] hover:bg-surface-2 hover:text-[var(--color-text-primary)]'
                  : 'text-[var(--color-text-secondary)] hover:bg-surface-2 hover:text-[var(--color-text-primary)]'
            }`}
          >
            {heading.text}
          </button>
        );
      })}
    </nav>
  );
}
