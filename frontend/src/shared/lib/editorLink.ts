import type { Editor } from '@tiptap/react';
import { LINK_MARK_NAME, normalizeLinkInput } from './linkSafety';

/*
 * リンクを掛ける・外す操作。ナレッジの本文エディタ（pages/kb）とバックログの本文エディタ
 * （pages/backlog）が LinkUrlForm を通して同じものを呼ぶ。可否の判定は normalizeLinkInput
 * （許可スキームの明示リスト）に一本化し、ここでは判定を増やさない。
 */

// フォーカスを当ててから操作する（ボタン経由でも選択・キャレットを保って実行する）。
const focused = (editor: Editor) => editor.chain().focus();

/**
 * applyLink は入力欄に打たれた文字列をリンクとして掛ける。掛けられたら true。
 *
 * 許可できない URL（`javascript:` など）は normalizeLinkInput が null を返すので何もせず false。
 * 「掛けようとしたが弾かれた」ことを UI が知って利用者に伝えられるよう、例外ではなく戻り値で返す。
 * extendMarkRange は、既にリンクが掛かった語の中にキャレットを置いただけの状態でも
 * そのリンク全体を対象にするための指定（選択し直さずに URL を貼り替えられる）。
 */
export function applyLink(editor: Editor, rawInput: string): boolean {
  const href = normalizeLinkInput(rawInput);
  if (href === null) return false;
  return focused(editor).extendMarkRange(LINK_MARK_NAME).setLink({ href }).run();
}

/** removeLink はキャレット / 選択範囲のリンクを解除する（文字はそのまま残る）。 */
export function removeLink(editor: Editor): boolean {
  return focused(editor).extendMarkRange(LINK_MARK_NAME).unsetLink().run();
}
