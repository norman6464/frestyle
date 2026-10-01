import { type Editor, useEditorState } from '@tiptap/react';
import { getEditorCommands, type EditorCommand } from './editorCommands';
import LinkFormatControl from './LinkFormatControl';
import EditorCommandGlyph from './EditorCommandGlyph';
import CommentFormatControl from './CommentFormatControl';
import type { CommentAnchor } from './commentAnchor';

// バブルメニューが出す操作はマーク（太字…）とブロック変換（見出し・リスト…）に絞る。
// 挿入系・履歴系はスラッシュメニュー / キーボードに委ねる（後続）。
const BUBBLE_COMMANDS = getEditorCommands('mark', 'turn');

// glyph（字面）の見た目付けは presentation の責務なので、レジストリ（データ）には持たせず
// ここで id ごとに対応づける。未指定は等幅の素の字面。
const GLYPH_CLASS: Record<string, string> = {
  bold: 'font-bold',
  italic: 'italic',
  underline: 'underline',
  strike: 'line-through',
  code: 'font-mono text-xs',
  codeBlock: 'font-mono text-xs',
  blockquote: 'font-serif',
};

function MenuButton({
  command,
  editor,
  active,
  disabled,
}: {
  command: EditorCommand;
  editor: Editor;
  active: boolean;
  disabled: boolean;
}) {
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
      <EditorCommandGlyph command={command} glyphClassName={GLYPH_CLASS[command.id] ?? ''} />
    </button>
  );
}

/**
 * FormatMenuBar は書式コマンドのボタン列（presentational）。
 * EDITOR_COMMANDS（レジストリ）から描画し、editor の現在状態を useEditorState で購読して
 * 各ボタンの active / disabled を更新する。バブルメニュー等の入れ物からフローティング表示する。
 */
export default function FormatMenuBar({
  editor,
  editable,
  onRequestComment,
}: {
  editor: Editor;
  /**
   * 書式ボタン（太字等）・リンクを出すか。false でも「コメント」ボタンは
   * onRequestComment があれば出す — 編集権限は無くコメントだけできる立場
   * （domain.GrantRoleCommenter）が実在するため、書式操作とコメント可否は別軸。
   */
  editable: boolean;
  /** 選択範囲からコメントを作りたいときに呼ばれる。渡さなければ「コメント」ボタンを出さない。 */
  onRequestComment?: (anchor: CommentAnchor) => void;
}) {
  // 各コマンドの active/enabled だけを取り出して購読する（過剰な再描画を避ける）。
  const states = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) =>
      BUBBLE_COMMANDS.map((command) => ({
        active: command.isActive?.(currentEditor) ?? false,
        enabled: command.isEnabled?.(currentEditor) ?? true,
      })),
  });

  return (
    <div role="toolbar" aria-label="書式メニュー" className="flex items-center gap-0.5">
      {editable && (
        <>
          {BUBBLE_COMMANDS.map((command, index) => (
            <MenuButton
              key={command.id}
              command={command}
              editor={editor}
              active={states[index].active}
              disabled={!states[index].enabled}
            />
          ))}
          {/*
            リンクだけは URL の入力を伴うため記述子（EDITOR_COMMANDS）では表せない。
            マーク操作の並びの末尾に、入力欄を持つ専用コントロールとして置く。
          */}
          <LinkFormatControl editor={editor} />
        </>
      )}
      {/*
        コメントは記述子に載せず、専用コントロールとして置く（画面側の業務ロジックを呼ぶため）。
        editable の外に置く — 編集権限が無くコメントだけできる立場でも使える必要があるため。
      */}
      <CommentFormatControl editor={editor} onRequestComment={onRequestComment} />
    </div>
  );
}
