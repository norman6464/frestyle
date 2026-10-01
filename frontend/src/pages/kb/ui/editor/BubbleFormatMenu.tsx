import { BubbleMenu } from '@tiptap/react/menus';
import type { Editor } from '@tiptap/react';
import FormatMenuBar from './FormatMenuBar';
import type { CommentAnchor } from './commentAnchor';

export interface BubbleFormatMenuProps {
  editor: Editor;
  /**
   * 書式ボタン（太字等）・リンクを出すか。false でも「コメント」ボタンは
   * onRequestComment があれば出す（編集権限は無くコメントだけできる立場のため）。
   */
  editable: boolean;
  /** 選択範囲からコメントを作りたいときに呼ばれる。渡さなければ「コメント」ボタンを出さない。 */
  onRequestComment?: (anchor: CommentAnchor) => void;
}

/**
 * BubbleFormatMenu はテキスト選択時に浮かぶ書式メニュー。
 * 位置決め（フローティング）だけを担い、中身は presentational な FormatMenuBar に委ねる。
 * 固定ツールバーを置かないインライン編集で、選択したときにだけ書式操作を出すための入れ物。
 */
export default function BubbleFormatMenu({ editor, editable, onRequestComment }: BubbleFormatMenuProps) {
  return (
    <BubbleMenu editor={editor} className="rte-bubble">
      <FormatMenuBar editor={editor} editable={editable} onRequestComment={onRequestComment} />
    </BubbleMenu>
  );
}
