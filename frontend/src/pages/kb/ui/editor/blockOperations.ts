import { Extension, type JSONContent } from '@tiptap/core';
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type Transaction } from '@tiptap/pm/state';

/**
 * いちばん外（doc 直下）のブロック 1 つを単位にした操作。取っ手（BlockHandle）のメニュー・
 * '/' メニュー・キーボード（Alt+↑ / Alt+↓）がすべて同じ命令を呼ぶ。
 *
 * 「いちばん外」にそろえるのは、リストの項目や表のセルの中にカーソルがあるときに、項目だけが
 * リストの外へ飛び出す（スキーマに合わない）ような動きを起こさないため。動くのは常にリスト全体・表全体。
 */

/** doc 直下のブロックの位置（pos はノードの手前）と中身。 */
export interface TopLevelBlock {
  pos: number;
  node: ProseMirrorNode;
  /** doc の何番目の子か。 */
  index: number;
}

/** topLevelBlockOf は、解決済みの位置を含む doc 直下のブロックを返す。 */
export function topLevelBlockOf($pos: ResolvedPos): TopLevelBlock | null {
  if ($pos.depth === 0) {
    // NodeSelection（画像・区切り線など）は depth 0 で、ノードは位置の直後にある。
    const node = $pos.nodeAfter;
    return node ? { pos: $pos.pos, node, index: $pos.index(0) } : null;
  }
  return { pos: $pos.before(1), node: $pos.node(1), index: $pos.index(0) };
}

/**
 * selectionForBlock は、位置 pos にあるブロックの中へカーソルを置く選択を作る。
 * 文字を持つブロックは先頭の文字位置、リストや表は中の最初の文字位置、
 * 文字を持たないブロック（画像・区切り線）はノード選択。
 */
export function selectionForBlock(doc: ProseMirrorNode, pos: number) {
  const node = doc.nodeAt(pos);
  if (!node) return null;
  if (node.isAtom || node.content.size === 0) return NodeSelection.create(doc, pos);
  return TextSelection.near(doc.resolve(pos + 1), 1);
}

/** stripIds は複製のために、ブロック自身と中のすべてのノードから attrs.id を外す。 */
function stripIds(json: JSONContent): JSONContent {
  const next: JSONContent = { ...json };
  if (next.attrs && 'id' in next.attrs) {
    const { id: _dropped, ...rest } = next.attrs;
    next.attrs = rest;
  }
  if (Array.isArray(next.content)) next.content = next.content.map(stripIds);
  return next;
}

function canMove(tr: Transaction, dir: -1 | 1): TopLevelBlock | null {
  const block = topLevelBlockOf(tr.selection.$from);
  if (!block) return null;
  const targetIndex = block.index + dir;
  if (targetIndex < 0 || targetIndex >= tr.doc.childCount) return null;
  return block;
}

/**
 * moveBlock はカーソルのあるブロックを 1 つ上（-1）または下（+1）の兄弟と入れ替える。
 * ノードはそのまま（attrs.id も付いたまま）動くので、コメントの錨は外れない。
 * カーソルは動かしたブロックの中の同じ場所に付いていく。
 */
function moveBlock(tr: Transaction, dir: -1 | 1): boolean {
  const block = canMove(tr, dir);
  if (!block) return false;
  const sibling = tr.doc.child(block.index + dir);
  const start = dir === -1 ? block.pos - sibling.nodeSize : block.pos;
  const end = dir === -1 ? block.pos + block.node.nodeSize : block.pos + block.node.nodeSize + sibling.nodeSize;
  const offsetInBlock = tr.selection.from - block.pos;
  const wasNodeSelection = tr.selection instanceof NodeSelection;

  tr.replaceWith(start, end, dir === -1 ? [block.node, sibling] : [sibling, block.node]);

  const movedPos = dir === -1 ? start : start + sibling.nodeSize;
  tr.setSelection(
    wasNodeSelection ? NodeSelection.create(tr.doc, movedPos) : TextSelection.create(tr.doc, movedPos + offsetInBlock),
  );
  tr.scrollIntoView();
  return true;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    blockOperations: {
      /** カーソルのあるいちばん外のブロックを 1 つ上へ。いちばん上なら何もしない。 */
      moveBlockUp: () => ReturnType;
      /** カーソルのあるいちばん外のブロックを 1 つ下へ。いちばん下なら何もしない。 */
      moveBlockDown: () => ReturnType;
      /** カーソルのあるいちばん外のブロックを直後に複製する（id は新しく振られる）。 */
      duplicateBlock: () => ReturnType;
      /** カーソルのあるいちばん外のブロックを消す。最後の 1 つなら空の段落に置き換える。 */
      deleteBlock: () => ReturnType;
    };
  }
}

/**
 * BlockOperations はブロック単位の命令とキーボード（Alt+↑ / Alt+↓）を足す拡張。
 * スキーマは変えない（editorExtensions 側で合成する）。
 */
export const BlockOperations = Extension.create({
  name: 'blockOperations',

  addCommands() {
    return {
      moveBlockUp:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return canMove(tr, -1) !== null;
          return moveBlock(tr, -1);
        },
      moveBlockDown:
        () =>
        ({ tr, dispatch }) => {
          if (!dispatch) return canMove(tr, 1) !== null;
          return moveBlock(tr, 1);
        },
      duplicateBlock:
        () =>
        ({ tr, dispatch }) => {
          const block = topLevelBlockOf(tr.selection.$from);
          if (!block) return false;
          if (!dispatch) return true;
          // id を外した写しを直後に入れる。新しい id は StableBlockId（appendTransaction）が振るので、
          // ここで採番しない（採番の仕方を 2 か所に持たない）。
          const copy = block.node.type.schema.nodeFromJSON(stripIds(block.node.toJSON()));
          const insertAt = block.pos + block.node.nodeSize;
          tr.insert(insertAt, copy);
          const selection = selectionForBlock(tr.doc, insertAt);
          if (selection) tr.setSelection(selection);
          tr.scrollIntoView();
          return true;
        },
      deleteBlock:
        () =>
        ({ tr, dispatch }) => {
          const block = topLevelBlockOf(tr.selection.$from);
          if (!block) return false;
          if (!dispatch) return true;
          const end = block.pos + block.node.nodeSize;
          if (tr.doc.childCount === 1) {
            // doc は最低 1 つのブロックを要する。空の段落に置き換えて、書き始められる状態を残す。
            tr.replaceWith(block.pos, end, tr.doc.type.schema.nodes.paragraph.create());
            tr.setSelection(TextSelection.create(tr.doc, block.pos + 1));
            return true;
          }
          tr.delete(block.pos, end);
          // カーソルは次のブロック（無ければ前のブロック）の中へ。
          const at = Math.min(block.pos, tr.doc.content.size);
          tr.setSelection(TextSelection.near(tr.doc.resolve(at), 1));
          tr.scrollIntoView();
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Alt-ArrowUp': () => this.editor.commands.moveBlockUp(),
      'Alt-ArrowDown': () => this.editor.commands.moveBlockDown(),
    };
  },
});
