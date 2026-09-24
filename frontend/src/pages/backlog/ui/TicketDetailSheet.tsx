import { useEffect, useRef, type ReactNode } from 'react';
import { FsIcon } from '@/shared/ui';

export interface TicketDetailSheetProps {
  open: boolean;
  /** 見出し（「選択中 FRESTYLE-457」）。読み上げの名前と、開いたときのフォーカスの着地点。 */
  label: string;
  /** 一覧へ戻る。選択も絞り込みも残る（選択解除とは別の操作）。 */
  onBack: () => void;
  children: ReactNode;
}

/** 入力中の欄の Escape は欄のもの（打ちかけを消さない）。面を閉じる判定から外す。 */
function isEditable(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[contenteditable="true"], textarea, input, select') !== null;
}

/**
 * 狭い画面の詳細（設計ボード ST13）。一覧に重なる全幅の 1 列で、上に「← 一覧へ」だけを置く。
 *
 * 戻るのは「一覧へ」1 本にし、選択解除は一覧の下の帯に置く（戻ることと選び直すことは別の操作。
 * 同じ ✕ を 2 つ並べると、どちらが何をするのか分からない）。
 *
 * ヘッダーと下のナビは隠さない（ボードどおり、ほかの行き先へはそのまま移れる）ので、
 * 画面全体を塞ぐ dialog は名乗らない。代わりに一覧の側を inert にして（呼び出し側）、Tab が
 * 裏の一覧へ抜けないようにする。一覧は描いたまま重ねるので、戻るとスクロール位置も残っている。
 *
 * 開いたら見出しへフォーカスを移し、Escape でも戻る（入力中の欄の Escape は除く）。
 */
export default function TicketDetailSheet({ open, label, onBack, children }: TicketDetailSheetProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const backRef = useRef(onBack);
  useEffect(() => {
    backRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    if (!open) return undefined;
    headingRef.current?.focus();
    const section = sectionRef.current;
    if (!section) return undefined;
    // 面の中の Escape だけを拾う（選択欄の候補など、面の外へ描かれる物の Escape はそちらのもの）。
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isEditable(event.target)) return;
      event.preventDefault();
      backRef.current();
    };
    section.addEventListener('keydown', handleKey);
    return () => section.removeEventListener('keydown', handleKey);
  }, [open]);

  if (!open) return null;
  return (
    <section
      ref={sectionRef}
      aria-labelledby="ticket-detail-sheet-heading"
      className="fixed inset-x-0 bottom-[calc(var(--app-bottom-nav-h)+env(safe-area-inset-bottom,0px))] top-[var(--app-header-h)] z-30 flex flex-col bg-surface-1 md:hidden"
    >
      <header className="shrink-0 border-b border-surface-3 px-3 pb-2 pt-2">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 text-base font-semibold text-[var(--color-text-primary)] transition-colors duration-fast hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <FsIcon name="chevron-left" className="h-4 w-4" />
          一覧へ
        </button>
        <p className="px-2 text-xs text-[var(--color-text-muted)]">条件を保持して戻る</p>
        <h2
          id="ticket-detail-sheet-heading"
          ref={headingRef}
          tabIndex={-1}
          // 見た目はボードどおり出さない（キーと種別は本文の先頭にある）。キーボードで来た人にだけ、
          // フォーカスの居場所として見せる。
          className="sr-only focus-visible:not-sr-only focus-visible:rounded-md focus-visible:px-2 focus-visible:text-xs focus-visible:text-[var(--color-text-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          {label}
        </h2>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
    </section>
  );
}
