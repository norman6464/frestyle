import { type Editor, useEditorState } from '@tiptap/react';
import { getEditorCommands } from './editorCommands';
import LinkFormatControl from './LinkFormatControl';
import ColorFormatControl from './ColorFormatControl';
import MenuButton from './MenuButton';
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
              glyphClassName={GLYPH_CLASS[command.id] ?? ''}
            />
          ))}
          {/*
            色（文字色・蛍光ペン）とリンクは「値を選ぶ・入力する」操作なので記述子（EDITOR_COMMANDS）
            では表せない。マーク操作の並びの末尾に、専用のコントロールとして置く（色 → リンクの順）。
          */}
          <ColorFormatControl editor={editor} />
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
