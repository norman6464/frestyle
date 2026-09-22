import { useEffect, useRef, useState } from 'react';
import type { KbIcon } from '@/entities/kb';
import KbPageIconPicker from './KbPageIconPicker';
import { FsIcon } from '@/shared/ui';

export interface KbPageIconButtonProps {
  /** 未設定は null（明示的に外した）と undefined（旧応答）のどちらもあり得る。 */
  icon?: KbIcon | null;
  canEdit: boolean;
  /**
   * 設定・変更・解除をまとめて担う（null が解除）。**失敗は投げてくる**前提
   * （呼び出し側がトーストで知らせ、ピッカーは開いたままになる）。
   */
  onChange: (icon: KbIcon | null) => Promise<void>;
}

/**
 * KbPageIconButton はページ見出しの左に置くアイコンの表示・変更口。
 *
 * 4 状態:
 *   読むだけ + 未設定  → 何も出さない（無いものを匂わせる要素を置かない）
 *   読むだけ + 設定済み → 絵文字を役割 img で出すだけ（押せない）
 *   書ける + 未設定    → 「アイコンを追加」。入力手段によらず見つけられるよう常に表示。
 *   書ける + 設定済み   → 絵文字そのものが aria-expanded なボタン
 *
 * ピッカーの開閉と外側クリック・Escape での消し方は KbRowActions と同じ形。
 */
export default function KbPageIconButton({ icon, canEdit, onChange }: KbPageIconButtonProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        containerRef.current.contains(event.target)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  if (!canEdit) {
    if (!icon) return null;
    return (
      <span role="img" aria-label="ページのアイコン" className="mb-1 block text-4xl leading-none">
        {icon.value}
      </span>
    );
  }

  const picker = open && (
    <div className="absolute left-0 top-full z-20 mt-1">
      <KbPageIconPicker
        current={icon ?? null}
        onSelect={(next) => onChange(next)}
        onClear={() => onChange(null)}
        onClose={() => setOpen(false)}
      />
    </div>
  );

  if (!icon) {
    return (
      <div ref={containerRef} className="relative mb-1 inline-block">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-label="アイコンを追加"
          aria-expanded={open}
          className="flex min-h-11 items-center gap-2 rounded-md px-2 py-2 text-sm text-[var(--color-text-muted)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
        >
          <FsIcon name="smile" className="h-4 w-4" />
          アイコンを追加
        </button>
        {picker}
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative mb-1 inline-block">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="ページのアイコンを変更"
        aria-expanded={open}
        className="min-h-12 min-w-12 rounded text-4xl leading-none hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
      >
        <span data-icon="emoji" aria-hidden="true">
          {icon.value}
        </span>
      </button>
      {picker}
    </div>
  );
}
