import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import TableMenuBar from './TableMenuBar';

/**
 * tableElementOf はカーソルを含む表の DOM 要素を返す（表の中にいなければ null）。
 * 吹き出しを選択範囲ではなく表の上端に固定するための参照に使う。
 */
function tableElementOf(editor: Editor): HTMLElement | null {
  const { $from } = editor.state.selection;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'table') {
      const dom = editor.view.nodeDOM($from.before(depth));
      return dom instanceof HTMLElement ? dom : null;
    }
  }
  return null;
}

/**
 * TableBubbleMenu はカーソルが表の中にあるときだけ、表の上端に浮かぶ操作の吹き出し。
 *
 * 文字を選んだときの書式の吹き出し（BubbleFormatMenu）とは別の吹き出しとして置く。
 * 書式の吹き出しは選択範囲の上に出るが、表の操作は「どのセルを選んでいるか」より
 * 「どの表を触っているか」で場所が決まるので、表そのものに付ける。
 * 中身のボタン列は TableMenuBar が担う。
 */
export default function TableBubbleMenu({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubbleMenu"
      className="rte-bubble"
      shouldShow={({ editor: currentEditor }) => currentEditor.isEditable && currentEditor.isActive('table')}
      getReferencedVirtualElement={() => tableElementOf(editor)}
      options={{ placement: 'top-start', offset: 6 }}
    >
      <TableMenuBar editor={editor} />
    </BubbleMenu>
  );
}
