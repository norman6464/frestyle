import { useEffect, useRef, type MutableRefObject } from 'react';
import type { Editor } from '@tiptap/react';
import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/**
 * CommentBadgeCounts はブロックIDごとの未解決コメント件数。0件のブロックはキーを持たない
 * （「無い」＝0件、を持たせない — 走査側は key の有無だけで判定できる）。
 */
export type CommentBadgeCounts = Record<string, number>;

/**
 * コメント件数バッジの Decoration.widget を保持する ProseMirror プラグインの鍵。
 * decorations の読み出しにも、外部からの再計算指示（setMeta）にも同じ鍵を使う
 * （鍵が 1 つなので、name の文字列一致のような取り違えが起きない）。
 */
const COMMENT_BADGES_PLUGIN_KEY = new PluginKey<DecorationSet>('commentBadges');

/**
 * useCommentBadgeSync は「コメントスレッド一覧（React state）」というエディタの外の状態が
 * 変わるたびに、ProseMirror プラグインへ decorations の再計算を促す橋渡し。
 *
 * ProseMirror の decorations はエディタ自身の transaction（doc・selection の変更）でしか
 * 再計算されない。件数の元データ（countsByBlockId）は React state（useKbComments の一覧）
 * から来るので、一覧だけが更新されても doc は変わらず、そのままでは decorations が
 * 古いまま取り残される。ここでは「countsByBlockId が変わるたびに、一意な PluginKey を
 * setMeta した空 transaction を dispatch して、プラグイン側の再計算を強制する」という、
 * tiptap の共同編集カーソル等でも使われる標準的な手法を使う。
 *
 * 戻り値の ref は最新の countsByBlockId を指す。プラグインの decorations 計算は
 * **この ref.current を読む**。extensions 配列（＝プラグイン自体）はエディタ生成時に
 * 固定される（RichTextEditorProps の extraSlashCommands と同じ契約）ため、値の変化を
 * props の再受け渡しではなく ref 越しに伝える必要がある。
 *
 * editor 引数は「まだ生成されていない（null）」呼び出しを許す。RichTextEditor.tsx では
 * extensions 配列を組み立てる都合上、useEditor() を呼ぶ**前**にこの hook を呼んで ref を
 * 得る必要があり、その時点では実体の editor がまだ無い（ref 経由で渡す）。null の間は
 * dispatch をスキップするだけで安全 — 生成直後の decorations は下の
 * createCommentBadgesExtension が ref.current の現在値から組み立てるので、初期表示が
 * 欠けることはない。
 */
export function useCommentBadgeSync(
  editor: Editor | null,
  countsByBlockId: CommentBadgeCounts,
): MutableRefObject<CommentBadgeCounts> {
  const countsRef = useRef(countsByBlockId);

  useEffect(() => {
    countsRef.current = countsByBlockId;
    if (!editor || editor.isDestroyed) return;
    const tr = editor.view.state.tr.setMeta(COMMENT_BADGES_PLUGIN_KEY, true);
    editor.view.dispatch(tr);
  }, [editor, countsByBlockId]);

  return countsRef;
}

/**
 * buildCommentBadgeDecorations は doc 全体を走査し、件数が 1 以上のブロックへ
 * バッジ（button）の widget decoration を組み立てる。
 *
 * 対象は「id（stableBlockId.ts が保証する attrs.id）を持ち、counts にその id のエントリが
 * 1 以上の整数で存在する」ノードだけ。ノード型を BLOCK_NODE_TYPES で絞らないのは、
 * id を持つのがそもそもその集合のノードだけだから（二重にチェックする理由が無い）。
 */
function buildCommentBadgeDecorations(
  state: EditorState,
  counts: CommentBadgeCounts,
  onBadgeClick: (blockId: string) => void,
): DecorationSet {
  const decorations: Decoration[] = [];

  state.doc.descendants((node, pos) => {
    const blockId = node.attrs.id;
    if (typeof blockId !== 'string' || blockId === '') return;
    const count = counts[blockId];
    if (!Number.isInteger(count) || count < 1) return;

    const badge = document.createElement('button');
    badge.type = 'button';
    badge.className = 'rte-comment-badge';
    // 本文編集のキャレット/選択に干渉しない（CodeBlockView の右上ツールバーと同じ作法）。
    badge.setAttribute('contenteditable', 'false');
    badge.setAttribute('aria-label', `コメント ${count} 件`);
    badge.textContent = String(count);
    badge.addEventListener('mousedown', (event) => event.preventDefault());
    badge.addEventListener('click', () => onBadgeClick(blockId));

    // ブロックの「コンテンツ末尾、ノードが閉じる直前」の位置に置く（stableBlockId.ts の
    // ブロック内オフセットの考え方と同じく、doc 全体の position ではなくノード自身の
    // 範囲内に収める）。side: 1 は「その位置にある他の要素より後ろ」に描くための指定。
    decorations.push(Decoration.widget(pos + node.nodeSize - 1, badge, { side: 1 }));
  });

  return DecorationSet.create(state.doc, decorations);
}

/**
 * createCommentBadgesExtension はコメント件数バッジを Decoration.widget として描画する
 * tiptap Extension を組み立てる。
 *
 * NodeView ではなく decoration で実装する理由: バッジを付けうるブロックノードは
 * commentAnchor.ts の COMMENT_ANCHOR_BLOCK_TYPES 相当の 15 種あり、全種へ NodeView を
 * 足すのは既存のノード定義（schemaExtensions.ts）に手を入れる範囲が広すぎる。decoration
 * なら既存のノード定義に一切手を入れずに済む。
 *
 * プラグインの state は init/apply の両方で buildCommentBadgeDecorations を呼んで
 * DecorationSet を組み立てる。apply は「doc が変わった」または「useCommentBadgeSync が
 * setMeta で再計算を指示した」ときだけ組み立て直し、それ以外（selection のみの変更等）は
 * old.map(...) で位置だけ追従させ、無駄な走査を避ける。
 */
export function createCommentBadgesExtension(
  countsRef: MutableRefObject<CommentBadgeCounts>,
  onBadgeClick: (blockId: string) => void,
) {
  return Extension.create({
    name: 'commentBadges',

    addProseMirrorPlugins() {
      return [
        new Plugin<DecorationSet>({
          key: COMMENT_BADGES_PLUGIN_KEY,
          state: {
            init: (_config, state) => buildCommentBadgeDecorations(state, countsRef.current, onBadgeClick),
            apply: (tr: Transaction, old: DecorationSet, _oldState, newState) => {
              if (tr.docChanged || tr.getMeta(COMMENT_BADGES_PLUGIN_KEY)) {
                return buildCommentBadgeDecorations(newState, countsRef.current, onBadgeClick);
              }
              return old.map(tr.mapping, tr.doc);
            },
          },
          props: {
            decorations(state) {
              return COMMENT_BADGES_PLUGIN_KEY.getState(state);
            },
          },
        }),
      ];
    },
  });
}
