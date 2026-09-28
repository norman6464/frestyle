import { useEffect, useRef, useState } from 'react';
import { FsIcon } from '@/shared/ui';

export interface KbSectionHeadingProps {
  /** 節の名前（「チームスペース」「プライベート」）。 */
  label: string;
  /** 上に区切り線を引くか。節が続くときだけ引く（最初の節の上には引かない）。 */
  divider?: boolean;
  /** ＋ を押したとき（スペースを作る）。未指定なら ＋ 自体を出さない（作る入口が無い節向け）。 */
  onAdd?: () => void;
  /** ＋ の読み上げ名。「何が増えるか」を言う。onAdd と対で指定する。 */
  addLabel?: string;
  /** ⋯ のメニュー項目。空なら ⋯ 自体を出さない（押せない印を並べない）。 */
  menuItems?: { label: string; onSelect: () => void }[];
}

/**
 * KbSectionHeading はサイドバーの節の見出し（「チームスペース」「プライベート」）。
 *
 * **触れているときだけ操作が現れる。** 見出しは場所の目印で、普段は文字だけの方が
 * 木の形が読みやすい。＋ と ⋯ は `opacity` で隠すだけで DOM からは外さない —
 * 外すと Tab の順序が触れるたびに変わり、キーボードでは追えなくなる（行の操作と同じ扱い）。
 */
export default function KbSectionHeading({
  label,
  divider = false,
  onAdd,
  addLabel,
  menuItems = [],
}: KbSectionHeadingProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        containerRef.current.contains(event.target)
      ) {
        return;
      }
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  return (
    <div
      ref={containerRef}
      className={`group relative mt-1 flex items-center justify-between rounded-md px-2 py-1 transition-colors hover:bg-surface-2 ${
        // 節の区切りは線で示す。上下の余白だけだと、木が長いときに節の切れ目が読めない。
        divider ? 'mt-3 border-t border-surface-3 pt-2' : ''
      }`}
    >
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-tertiary)]">
        {label}
      </h2>

      <div
        className={`flex shrink-0 items-center gap-0.5 transition-opacity ${
          menuOpen ? 'opacity-100' : 'opacity-0 focus-within:opacity-100 group-hover:opacity-100'
        }`}
      >
        {menuItems.length > 0 && (
          <button
            type="button"
            onClick={() => setMenuOpen((prev) => !prev)}
            aria-expanded={menuOpen}
            aria-label={`${label} の操作`}
            className="rounded p-0.5 text-[var(--color-text-tertiary)] hover:bg-surface-3"
          >
            <FsIcon name="more" className="h-3.5 w-3.5" />
          </button>
        )}
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            aria-label={addLabel}
            title={addLabel}
            className="rounded p-0.5 text-[var(--color-text-tertiary)] hover:bg-surface-3"
          >
            <FsIcon name="plus" className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {menuOpen && (
        // 素のボタンの一覧として出す（menu を名乗ると矢印キーでの移動を約束することになる）。
        <ul className="absolute right-0 top-full z-20 mt-1 w-44 rounded-lg border border-surface-3 bg-surface-1 py-1 shadow-lg">
          {menuItems.map((item) => (
            <li key={item.label}>
              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  item.onSelect();
                }}
                className="w-full px-3 py-1.5 text-left text-sm normal-case tracking-normal text-[var(--color-text-primary)] hover:bg-surface-2"
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
