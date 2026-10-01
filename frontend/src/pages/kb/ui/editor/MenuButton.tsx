import type { Editor } from '@tiptap/react';
import type { EditorCommand } from './editorCommands';
import EditorCommandGlyph from './EditorCommandGlyph';

interface MenuButtonProps {
  command: EditorCommand;
  editor: Editor;
  active: boolean;
  disabled: boolean;
  /** 字面（glyph）で出すときの見た目（太字の B を太く、など）。アイコンのときは使わない。 */
  glyphClassName?: string;
}

/**
 * MenuButton は書式・表の吹き出しに並ぶボタン 1 つ。記述子（EditorCommand）を受け取って描き、
 * 押すと run を呼ぶ。書式の吹き出し（FormatMenuBar）と表の吹き出し（TableMenuBar）が同じ物を使う。
 */
export default function MenuButton({ command, editor, active, disabled, glyphClassName = '' }: MenuButtonProps) {
  // トグル系（isActive を持つ）だけ aria-pressed を付ける（非トグルに押下状態を持たせない）。
  const togglable = command.isActive !== undefined;
  return (
    <button
      type="button"
      title={command.label}
      aria-label={command.label}
      aria-pressed={togglable ? active : undefined}
      disabled={disabled}
      // onMouseDown で preventDefault し、押下でエディタからフォーカス（＝選択）が外れないようにする。
      onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
      onClick={() => command.run(editor)}
      className={[
        'inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        active
          ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
      ].join(' ')}
    >
      <EditorCommandGlyph command={command} glyphClassName={glyphClassName} />
    </button>
  );
}
