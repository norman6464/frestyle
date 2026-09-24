import { useState } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { activeLinkHref } from './editorCommands';
import { LINK_MARK_NAME } from './linkSafety';
import LinkUrlForm from './LinkUrlForm';
import FormatIcon from '../FormatIcon';

/**
 * LinkFormatControl はバブルメニューの「リンク」操作（設定・貼り替え・解除）。
 *
 * 置き場所をバブルメニューにしたのは、リンクが「選択したテキストに掛ける」操作だからで、
 * 太字や斜体と同じ場所にあるのが自然なため（'/' メニューはカーソル位置へブロックを差し込む
 * 操作の場所で、選択への書式付けは扱わない）。
 *
 * FormatMenuBar の他のボタンと違い、この操作だけは URL という入力を人から受け取る必要があるので、
 * 記述子（EDITOR_COMMANDS）ではなく専用のコンポーネントにしてある。入力欄そのものは
 * LinkUrlForm（チケットの書式バーと共用）で、ここはボタンと開閉だけを持つ。
 *
 * 入力欄にフォーカスを移してもバブルメニューは消えない。tiptap の既定の表示条件が
 * 「フォーカスがメニューの中にある」場合も表示を続けるようになっているため。
 */
export default function LinkFormatControl({ editor }: { editor: Editor }) {
  const { active, href } = useEditorState({
    editor,
    selector: ({ editor: currentEditor }) => ({
      active: currentEditor.isActive(LINK_MARK_NAME),
      href: activeLinkHref(currentEditor),
    }),
  });

  const [open, setOpen] = useState(false);

  return (
    <div className="rte-link-control">
      <button
        type="button"
        title="リンク"
        aria-label="リンク"
        aria-pressed={active}
        aria-expanded={open}
        // onMouseDown で preventDefault し、押下でエディタから選択が外れないようにする
        //（選択が消えると、どこにリンクを掛けるのか分からなくなる）。
        onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
        onClick={() => setOpen((prev) => !prev)}
        className={[
          'inline-flex h-8 min-w-8 items-center justify-center rounded px-2 text-sm font-medium',
          'transition-colors',
          active || open
            ? 'bg-[var(--color-surface-3)] text-[var(--color-text-primary)]'
            : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-2)]',
        ].join(' ')}
      >
        <FormatIcon name="link" size={16} />
      </button>

      {open && (
        <LinkUrlForm
          editor={editor}
          initialHref={href ?? ''}
          canRemove={active}
          onClose={() => setOpen(false)}
          className="rte-link-form"
        />
      )}
    </div>
  );
}
