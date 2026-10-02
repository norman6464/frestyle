import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { INLINE_MARK_COLORS, INLINE_MARK_COLOR_LABELS, isInlineMarkColor, type InlineMarkColor } from './inlineColors';

function colorOf(value: unknown): InlineMarkColor | null {
  return isInlineMarkColor(value) ? value : null;
}

/** 1 列ぶんのパレット（8 色＋なし）。 */
function ColorRow({
  label,
  current,
  swatchPrefix,
  onPick,
}: {
  label: string;
  current: InlineMarkColor | null;
  /** 見本の色のクラスの接頭辞（文字色は rte-swatch-text-、蛍光ペンは rte-swatch-mark-）。 */
  swatchPrefix: string;
  onPick: (color: InlineMarkColor | null) => void;
}) {
  return (
    <div role="group" aria-label={label} className="rte-color-row">
      <span aria-hidden="true" className="rte-color-row__label">
        {label}
      </span>
      {INLINE_MARK_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={INLINE_MARK_COLOR_LABELS[color]}
          title={INLINE_MARK_COLOR_LABELS[color]}
          aria-pressed={current === color}
          className={`rte-color-swatch ${swatchPrefix}${color}`}
          // 押下でエディタの選択が外れないようにする（外れるとどこに色を掛けるのか分からなくなる）。
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(color)}
        />
      ))}
      <button
        type="button"
        aria-pressed={current === null}
        className="rte-color-none"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => onPick(null)}
      >
        なし
      </button>
    </div>
  );
}

/**
 * ColorFormatControl はバブルメニューの「色」（文字色・蛍光ペン）。
 *
 * リンクと同じく、記述子（EDITOR_COMMANDS）では表せない「値を選ぶ」操作なので専用の部品にする。
 * 押すと 2 列のパレット（文字色・蛍光ペン、それぞれ 8 色＋なし）が開く。色は名前だけを持ち、
 * 選べるのは決まった色だけ（自由な色は無い）。
 */
export default function ColorFormatControl({ editor }: { editor: Editor }) {
  const { textColor, highlight } = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      textColor: colorOf(currentEditor.getAttributes('textStyle').color),
      highlight: currentEditor.isActive('highlight') ? colorOf(currentEditor.getAttributes('highlight').color) : null,
    }),
  });
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);

  // 開いたら最初の見本へ焦点を移す（Escape・矢印キーがパレットに届くように。
  // 「色」ボタンは押下で本文の選択を外さないため、焦点は本文に残ったままになっている）。
  // 開いている間は、パレットの外を押したら閉じる。
  useEffect(() => {
    if (!open) return undefined;
    paletteRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current && event.target instanceof Node && !rootRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    editor.commands.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };

  return (
    <div ref={rootRef} className="rte-color-control">
      <button
        type="button"
        title="文字色・蛍光ペン"
        aria-label="色"
        aria-expanded={open}
        aria-pressed={textColor !== null || highlight !== null}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          'inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm font-medium',
          'transition-colors',
          open || textColor !== null || highlight !== null
            ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
        ].join(' ')}
      >
        {/* いま掛かっている色で「A」を描く（掛かっていなければ本文の色）。 */}
        <span
          aria-hidden="true"
          className={`rte-color-glyph ${textColor ? `rte-color-${textColor}` : ''} ${highlight ? `rte-highlight rte-highlight-${highlight}` : ''}`}
        >
          A
        </span>
      </button>

      {open && (
        <div ref={paletteRef} className="rte-color-palette" onKeyDown={onKeyDown}>
          <ColorRow
            label="文字色"
            current={textColor}
            swatchPrefix="rte-swatch-text-"
            onPick={(color) => {
              if (color === null) editor.chain().focus().unsetTextColor().run();
              else editor.chain().focus().setTextColor(color).run();
            }}
          />
          <ColorRow
            label="蛍光ペン"
            current={highlight}
            swatchPrefix="rte-swatch-mark-"
            onPick={(color) => {
              if (color === null) editor.chain().focus().unsetHighlight().run();
              else editor.chain().focus().setHighlight(color).run();
            }}
          />
        </div>
      )}
    </div>
  );
}
