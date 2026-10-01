import { type Editor, useEditorState } from '@tiptap/react';
import { getEditorCommands } from './editorCommands';
import MenuButton from './MenuButton';

const TABLE_COMMANDS = getEditorCommands('table');

/**
 * TableMenuBar は表の操作のボタン列（presentational）。
 * レジストリの table 群から描き、各ボタンの押せる／押せないを useEditorState で購読する。
 * 浮かべる場所は TableBubbleMenu が決める。
 */
export default function TableMenuBar({ editor }: { editor: Editor }) {
  // 押せるかどうかだけを取り出して購読する（過剰な再描画を避ける）。
  const enabled = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => TABLE_COMMANDS.map((command) => command.isEnabled?.(currentEditor) ?? true),
  });

  return (
    <div role="toolbar" aria-label="表の操作" className="flex flex-wrap items-center gap-0.5">
      {TABLE_COMMANDS.map((command, index) => (
        <MenuButton key={command.id} command={command} editor={editor} active={false} disabled={!enabled[index]} />
      ))}
    </div>
  );
}
