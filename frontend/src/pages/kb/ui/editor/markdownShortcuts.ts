import { Extension } from '@tiptap/react';
import { Plugin, PluginKey } from '@tiptap/pm/state';

// 見出し: # 〜 ###（全角 \uFF03 ＝＃ 混在可）＋ 半角/全角スペース（\u3000）で終わる段落全文。
const HEADING_PATTERN = /^([#\uFF03]{1,3})[ \u3000]$/;

// コードフェンス: ```（全角 \uFF40 ＝｀ の 3 連可）＋ 任意の言語名 ＋ 半角/全角スペースで終わる段落全文。
const FENCE_PATTERN = /^(?:`{3}|\uFF40{3})([A-Za-z0-9+#-]*)[ \u3000]$/;

/**
 * MarkdownShortcuts は「IME（日本語入力）の変換確定でも効く」Markdown 風ショートカット。
 *
 * ProseMirror の input rule はキーの直接入力（handleTextInput）でしか発火せず、
 * IME の確定（全角 ＃ や ｀ は必ず IME 経由）では呼ばれない。そこで appendTransaction で
 * 「確定後の段落テキスト」を見て変換する（入力経路に依存しない）。
 *
 * - `# `〜`### `（全角混在可・全角スペース可）→ 見出し 1〜3
 * - ``` （全角 ｀｀｀ 可・```sql のような言語名付き可）→ コードブロック（言語も設定）
 *
 * 暴発防止:
 * - IME 変換中（view.composing）は何もしない（確定後の doc 変化で変換する）
 * - キャレットがその段落の末尾にあるときだけ変換する（貼り付けや途中編集では発火しない）
 * - 半角の高速パス（既存 input rule）が先に効いた場合、段落はもう対象外なので二重変換しない
 */
export const MarkdownShortcuts = Extension.create({
  name: 'markdownShortcuts',

  addProseMirrorPlugins() {
    const { editor } = this;

    return [
      new Plugin({
        key: new PluginKey('markdownShortcuts'),
        appendTransaction: (transactions, _oldState, newState) => {
          if (!transactions.some((transaction) => transaction.docChanged)) return null;
          // IME 変換中は触らない（キャレットが壊れる）。確定後の doc 変化で改めて判定される。
          if (editor.view?.composing) return null;

          const { $from, empty } = newState.selection;
          if (!empty) return null;
          const block = $from.parent;
          if (block.type.name !== 'paragraph') return null;
          // キャレットが段落末尾にあるときだけ（＝いま打ち終えた行だけ）を対象にする。
          if ($from.parentOffset !== block.content.size) return null;

          const text = block.textContent;
          const blockStart = $from.start();

          const headingMatch = HEADING_PATTERN.exec(text);
          if (headingMatch) {
            const level = headingMatch[1].length;
            const headingType = newState.schema.nodes.heading;
            if (!headingType) return null;
            const tr = newState.tr;
            tr.delete(blockStart, blockStart + block.content.size);
            tr.setBlockType(blockStart, blockStart, headingType, { level });
            return tr;
          }

          const fenceMatch = FENCE_PATTERN.exec(text);
          if (fenceMatch) {
            const language = fenceMatch[1] !== '' ? fenceMatch[1].toLowerCase() : null;
            const codeBlockType = newState.schema.nodes.codeBlock;
            if (!codeBlockType) return null;
            const tr = newState.tr;
            tr.delete(blockStart, blockStart + block.content.size);
            tr.setBlockType(blockStart, blockStart, codeBlockType, { language });
            return tr;
          }

          return null;
        },
      }),
    ];
  },
});
