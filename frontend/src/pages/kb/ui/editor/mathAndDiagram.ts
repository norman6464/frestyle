import { Extension, InputRule, type Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection, TextSelection, type EditorState, type Selection } from '@tiptap/pm/state';
import { MATH_LATEX_MAX_LENGTH } from './schemaExtensions';

/** Enter（数式を選んだ状態）で MathView の入力欄を開くための出来事の名前。 */
export const MATH_EDIT_EVENT = 'rte-math-edit';

/** '/' の「図」で入れる最初の図。書式の手がかりとして、矢印 1 本の流れ図を置く。 */
export const DEFAULT_DIAGRAM_SOURCE = 'graph TD\n  A[はじめ] --> B[おわり]';

/**
 * 行内の数式の入力規則。`$式$` を打ち終えたら行内の数式にする。
 * 開きの `$` の直後と閉じの `$` の直前に空白を許さない（「$5 と $6」のような金額を誤って
 * 変換しない — pandoc と同じ決まり）。`\$` は文字としての $ なので開きにしない。
 */
const INLINE_MATH_INPUT = /(?:^|[^$\\])(\$([^\s$](?:[^$]*[^\s$\\])?)\$)$/;

/** 行の数式の入力規則。空の段落で `$$` に続けて空白を打つと行の数式にする。 */
const BLOCK_MATH_INPUT = /^\$\$\s$/;

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mathAndDiagram: {
      /** 行の数式を入れて選び、入力欄を開く（空の段落なら置き換える）。 */
      insertBlockMath: (latex?: string) => ReturnType;
      /** 行内の数式を入れて選び、入力欄を開く。 */
      insertInlineMath: (latex?: string) => ReturnType;
      /** 図を入れ、元の文字の末尾へカーソルを置く（空の段落なら置き換える）。 */
      insertDiagram: (source?: string) => ReturnType;
    };
  }
  interface Storage {
    mathAndDiagram: MathAndDiagramStorage;
  }
}

interface MathAndDiagramStorage {
  /** 入れた直後に入力欄を開いてほしい数式の位置（MathView が描かれたときに 1 度だけ読む）。 */
  editRequest: number | null;
}

/** takeMathEditRequest は、pos の数式に入力欄を開く依頼があれば取り出して true を返す。 */
export function takeMathEditRequest(editor: Editor, pos: number): boolean {
  const storage = editor.storage.mathAndDiagram as MathAndDiagramStorage | undefined;
  if (!storage || storage.editRequest !== pos) return false;
  storage.editRequest = null;
  return true;
}

/**
 * blockInsertRange は、いまの選択の場所にブロックを入れるときの置き換え範囲を返す。
 * 空の段落の中なら段落ごと置き換え、文字のある段落ならその後ろ、ブロックを選んでいればその後ろ。
 * 入れられない場所（要約の中など）なら null。
 */
function blockInsertRange(state: EditorState, type: ProseMirrorNode['type']): { from: number; to: number } | null {
  const { selection } = state;
  let from: number;
  let to: number;
  if (selection instanceof NodeSelection && selection.node.isBlock) {
    from = to = selection.to;
  } else if (selection.$from.depth === 0) {
    from = to = selection.$from.pos;
  } else {
    const { $from } = selection;
    const emptyTextblock = $from.parent.isTextblock && $from.parent.content.size === 0;
    from = emptyTextblock ? $from.before() : $from.after();
    to = emptyTextblock ? $from.after() : from;
  }
  const $at = state.doc.resolve(from);
  const index = $at.index();
  return $at.parent.canReplaceWith(index, to > from ? index + 1 : index, type) ? { from, to } : null;
}

function insertBlock(
  node: ProseMirrorNode,
  select: (doc: ProseMirrorNode, from: number) => Selection,
): (props: { state: EditorState; tr: import('@tiptap/pm/state').Transaction; dispatch?: unknown }) => boolean {
  return ({ state, tr, dispatch }) => {
    const range = blockInsertRange(state, node.type);
    if (!range) return false;
    if (dispatch) {
      tr.replaceWith(range.from, range.to, node);
      tr.setSelection(select(tr.doc, range.from)).scrollIntoView();
    }
    return true;
  };
}

/**
 * MathAndDiagram は数式と図の操作（命令・入力規則・Enter で入力欄を開く）をまとめた拡張。
 * スキーマ（ノードの形）は schemaExtensions.ts、描画は MathView / DiagramView。
 */
export const MathAndDiagram = Extension.create<Record<string, never>, MathAndDiagramStorage>({
  name: 'mathAndDiagram',

  addStorage() {
    return { editRequest: null };
  },

  addCommands() {
    const requestEdit = (pos: number) => {
      this.storage.editRequest = pos;
    };
    return {
      insertBlockMath:
        (latex = '') =>
        (props) => {
          const type = props.state.schema.nodes.blockMath;
          if (!type) return false;
          return insertBlock(type.create({ latex }), (doc, from) => {
            requestEdit(from);
            return NodeSelection.create(doc, from);
          })(props);
        },
      insertInlineMath:
        (latex = '') =>
        ({ state, tr, dispatch }) => {
          const type = state.schema.nodes.inlineMath;
          if (!type) return false;
          const { $from, $to } = state.selection;
          if (!$from.sameParent($to) || $from.parent.type.spec.code) return false;
          if (!$from.parent.canReplaceWith($from.index(), $to.indexAfter(), type)) return false;
          if (dispatch) {
            const from = state.selection.from;
            tr.replaceWith(from, state.selection.to, type.create({ latex }));
            requestEdit(from);
            tr.setSelection(NodeSelection.create(tr.doc, from)).scrollIntoView();
          }
          return true;
        },
      insertDiagram:
        (source = DEFAULT_DIAGRAM_SOURCE) =>
        (props) => {
          const { schema } = props.state;
          const type = schema.nodes.diagram;
          if (!type) return false;
          const node = type.create(null, source === '' ? null : schema.text(source));
          return insertBlock(node, (doc, from) => TextSelection.create(doc, from + 1 + node.content.size))(props);
        },
    };
  },

  addInputRules() {
    const requestEdit = (pos: number) => {
      this.storage.editRequest = pos;
    };
    return [
      new InputRule({
        find: INLINE_MATH_INPUT,
        handler: ({ state, range, match }) => {
          const type = state.schema.nodes.inlineMath;
          const whole = match[1];
          const latex = match[2];
          if (!type || whole === undefined || latex === undefined) return null;
          if ([...latex].length > MATH_LATEX_MAX_LENGTH) return null;
          const start = range.from + (match[0].length - whole.length);
          state.tr.replaceWith(start, range.to, type.create({ latex }));
        },
      }),
      new InputRule({
        find: BLOCK_MATH_INPUT,
        handler: ({ state, range }) => {
          const type = state.schema.nodes.blockMath;
          if (!type) return null;
          const $from = state.doc.resolve(range.from);
          // 段落の中身がちょうど `$$` のときだけ（文の途中の $$ は変換しない）。
          if ($from.parent.type.name !== 'paragraph' || $from.parent.textContent !== '$$') return null;
          const start = $from.before();
          const $start = state.doc.resolve(start);
          if (!$start.parent.canReplaceWith($start.index(), $start.index() + 1, type)) return null;
          state.tr.replaceWith(start, $from.after(), type.create({ latex: '' }));
          state.tr.setSelection(NodeSelection.create(state.tr.doc, start));
          requestEdit(start);
        },
      }),
    ];
  },

  addKeyboardShortcuts() {
    return {
      // 数式を選んだ状態の Enter は、改行ではなく入力欄を開く。
      Enter: ({ editor }) => {
        const { selection } = editor.state;
        if (!(selection instanceof NodeSelection)) return false;
        const name = selection.node.type.name;
        if (name !== 'inlineMath' && name !== 'blockMath') return false;
        if (!editor.isEditable) return false;
        const dom = editor.view.nodeDOM(selection.from);
        if (!(dom instanceof HTMLElement)) return false;
        const target = dom.matches('[data-math-view]') ? dom : dom.querySelector('[data-math-view]');
        target?.dispatchEvent(new CustomEvent(MATH_EDIT_EVENT));
        return true;
      },
    };
  },
});
