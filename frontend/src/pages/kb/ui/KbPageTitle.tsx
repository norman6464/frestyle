import { useRef, useState } from 'react';
import { AutoResizeTextarea } from '@/shared/ui';

export interface KbPageTitleProps {
  title: string;
  canEdit: boolean;
  /** 確定。**失敗は投げてくる**前提（投げられたら入力を保つ。知らせは呼び出し側）。 */
  onRename: (title: string) => Promise<void>;
  /** Enter で確定したとき（変換確定の Enter は除く）。本文へフォーカスを移すために使う。 */
  onEnter?: () => void;
}

/**
 * KbPageTitle はページ見出し。編集できる人には、見出しそのものが入力欄になる。
 *
 * 確定は Enter か欄外クリック（blur）。Escape は打ちかけを捨てて元に戻す。
 * 空での確定は「改名しない」に倒す（空の題名は木でクリックする場所が無くなる）。
 * 失敗しても入力は消さない — 消すと打ち直しになるうえ何が悪かったのか分からない
 * （サイドバーの改名・作成フォームと同じ約束）。
 */
export default function KbPageTitle({ title, canEdit, onRename, onEnter }: KbPageTitleProps) {
  // null は「編集していない」。編集中だけ下書きを持ち、確定・取消で null に戻す。
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Escape で取り消した直後の blur が、閉じ込めた古い下書きを確定してしまうのを防ぐ印。
  // （setDraft(null) はまだ描画に反映されておらず、blur ハンドラは取消前の値を見ている）
  const cancelledRef = useRef(false);

  if (!canEdit) {
    return (
      <h1 className="mb-3 text-3xl font-bold leading-tight text-[var(--color-text-primary)] [overflow-wrap:anywhere] md:text-4xl">
        {title}
      </h1>
    );
  }

  const commit = async () => {
    if (cancelledRef.current) {
      cancelledRef.current = false;
      return;
    }
    if (draft === null || saving) return;
    const next = draft.trim();
    if (next === '' || next === title) {
      // 空は改名しない・同じ値は何もしない。どちらも表示を元の題名へ戻す。
      setDraft(null);
      return;
    }
    setSaving(true);
    try {
      await onRename(next);
      setDraft(null);
    } catch {
      // 入力はそのまま残す。知らせは呼び出し側が出す。
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
    <h1 className="sr-only">{draft ?? title}</h1>
    <AutoResizeTextarea
      value={draft ?? title}
      aria-label="ページの題名"
      disabled={saving}
      onChange={(event) => setDraft(event.target.value.replace(/[\r\n]+/g, ' '))}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        // 日本語入力の変換確定 Enter は本文の確定ではない。isComposing を見ないと、
        // 変換のたびに打ちかけの題名で改名が飛ぶ（keyCode 229 は Safari の変換中の値）。
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
          // 確定の成否を待たずに本文へ移る（題名が変わっていなくても移る）。
          // 失敗したら入力は残り、知らせが出る — 移動を止める理由にはならない。
          onEnter?.();
        }
        if (event.key === 'Escape') {
          cancelledRef.current = true;
          setDraft(null);
          event.currentTarget.blur();
        }
      }}
      className="mb-3 min-h-14 w-full rounded-md border border-transparent bg-transparent px-1 text-3xl font-bold text-[var(--color-text-primary)] outline-none hover:border-surface-3 focus:ring-2 focus:ring-brand-600 md:text-4xl"
    />
    </>
  );
}
