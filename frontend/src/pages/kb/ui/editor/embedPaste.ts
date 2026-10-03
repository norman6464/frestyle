import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey, type EditorState } from '@tiptap/pm/state';
import { parseEmbedUrl, type EmbedVideo } from './embedUrl';

/**
 * isOnEmptyLine は、カーソルが空の段落（の中身の無い行）にあり、その段落を埋め込みに置き換えられるかを返す。
 * リストの最初の段落のように、段落でなければならない場所では置き換えない。
 */
function isOnEmptyLine(state: EditorState): boolean {
  const { selection, schema } = state;
  const { $from } = selection;
  if (!selection.empty || $from.depth === 0) return false;
  const parent = $from.parent;
  if (!parent.isTextblock || parent.type.spec.code || parent.content.size > 0) return false;
  const container = $from.node(-1);
  const index = $from.index(-1);
  return container.canReplaceWith(index, index + 1, schema.nodes.embed);
}

/**
 * insertEmbed は今のカーソルの位置に埋め込みを置く。空の行ならその行を埋め込みに置き換え、文のある行なら
 * その行を割って間に置く（tiptap の insertContentAt に任せる）。置けたら true。
 */
export function insertEmbed(editor: Editor, video: EmbedVideo): boolean {
  return editor
    .chain()
    .focus()
    .insertContentAt(editor.state.selection.from, {
      type: 'embed',
      attrs: { provider: video.provider, videoId: video.videoId },
    })
    .run();
}

/**
 * EmbedPaste は、空の行に動画の URL だけを貼ったとき、それを埋め込みに変える。
 *
 * 変えるのは「空の行に URL 1 つだけ」のときだけ。文の途中に貼った URL・読み取れない URL・URL 以外の文字を
 * 含む貼り付けは、今までどおり素のリンク・文字として入る（文の中のリンクを勝手にカードにしない）。
 */
export const EmbedPaste = Extension.create({
  name: 'embedPaste',

  addProseMirrorPlugins() {
    const editor = this.editor;
    return [
      new Plugin({
        key: new PluginKey('embedPaste'),
        props: {
          handlePaste(view, event) {
            const text = event.clipboardData?.getData('text/plain')?.trim() ?? '';
            if (text === '' || /\s/.test(text)) return false;
            const video = parseEmbedUrl(text);
            if (video === null || !isOnEmptyLine(view.state)) return false;
            return insertEmbed(editor, video);
          },
        },
      }),
    ];
  },
});
