import { type Editor, useEditorState } from '@tiptap/react';
import { resolveCommentAnchor, type CommentAnchor } from './commentAnchor';
import FsIcon from '../icons/FsIcon';

export interface CommentFormatControlProps {
  editor: Editor;
  /** 選択範囲からコメントを作りたいときに呼ばれる。渡されていなければ何も描画しない。 */
  onRequestComment?: (anchor: CommentAnchor) => void;
}

/**
 * CommentFormatControl はバブルメニューの「コメント」操作。
 *
 * LinkFormatControl と違って入力欄は持たない — 押した瞬間の選択範囲から
 * commentAnchor.ts の resolveCommentAnchor で錨（ブロックID・ブロック内オフセット・
 * 引用文）を計算し、そのまま呼び出し側（KbPage）へ渡すだけ。「コメントを作る」という
 * 業務そのもの（パネルを開く・スレッドを起こす）はこの部品の外（KbPage・
 * KbCommentsPanel）が持つ。
 *
 * disabled の判定に resolveCommentAnchor を使うのは、押せても意味の無い状態
 * （選択が空・複数ブロックにまたがる・id を持たないブロックの中）でボタンを押させない
 * ため — 押した後にエラーを出すより、そもそも押せなくする方が分かりやすい。
 *
 * onRequestComment が渡されていない画面（story・他画面）では、そもそもボタン自体を
 * 出さない（LinkFormatControl は常に出るが、コメントは KbPage 以外では意味を持たない
 * 機能のため、渡されて初めて存在する部品にしてある）。
 */
export default function CommentFormatControl({ editor, onRequestComment }: CommentFormatControlProps) {
  const anchor = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => resolveCommentAnchor(currentEditor.state),
  });

  if (!onRequestComment) return null;

  return (
    <button
      type="button"
      title="コメント"
      aria-label="コメント"
      disabled={anchor === null}
      // onMouseDown で preventDefault し、押下でエディタから選択が外れないようにする
      //（選択が消えると、どこにコメントを付けるのか分からなくなる。FormatMenuBar の
      // MenuButton・LinkFormatControl と同じ作法）。
      onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
      onClick={() => {
        if (anchor) onRequestComment(anchor);
      }}
      className={[
        'inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm font-medium',
        'transition-colors disabled:cursor-not-allowed disabled:opacity-40',
        'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
      ].join(' ')}
    >
      <FsIcon name="comment" className="h-4 w-4" />
    </button>
  );
}
