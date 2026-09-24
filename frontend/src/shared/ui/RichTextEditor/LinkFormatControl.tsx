import { useEffect, useRef, useState, type FormEvent } from 'react';
import { type Editor, useEditorState } from '@tiptap/react';
import { activeLinkHref, applyLink, removeLink } from './editorCommands';
import { LINK_MARK_NAME } from './linkSafety';
import FormatIcon from '../FormatIcon';

/** 許可できない URL を打たれたときに出す説明。何が通るのかを具体的に書く。 */
const INVALID_MESSAGE = 'http:// https:// mailto: tel: のいずれかで始まる URL を入力してください';

/**
 * LinkFormatControl はバブルメニューの「リンク」操作（設定・貼り替え・解除）。
 *
 * 置き場所をバブルメニューにしたのは、リンクが「選択したテキストに掛ける」操作だからで、
 * 太字や斜体と同じ場所にあるのが自然なため（'/' メニューはカーソル位置へブロックを差し込む
 * 操作の場所で、選択への書式付けは扱わない）。
 *
 * FormatMenuBar の他のボタンと違い、この操作だけは URL という入力を人から受け取る必要があるので、
 * 記述子（EDITOR_COMMANDS）ではなく専用のコンポーネントにしてある。書式ロジック自体は
 * editorCommands の applyLink / removeLink に置き、ここは入力欄の開閉と結果表示だけを持つ。
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
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 開いた直後に入力欄へ焦点を移す（クリックしてすぐ打ち始められるように）。
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const closeForm = () => {
    setOpen(false);
    setInvalid(false);
  };

  const toggleForm = () => {
    if (open) {
      closeForm();
      return;
    }
    // 既にリンクが掛かっていれば、その URL を初期値にして貼り替えやすくする。
    setDraft(href ?? '');
    setInvalid(false);
    setOpen(true);
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (applyLink(editor, draft)) {
      closeForm();
      return;
    }
    // 弾かれたときは閉じない。打ち直せる状態のまま理由を出す。
    setInvalid(true);
  };

  const handleRemove = () => {
    removeLink(editor);
    closeForm();
  };

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
        onClick={toggleForm}
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
        <form
          aria-label="リンクの設定"
          className="rte-link-form"
          onSubmit={handleSubmit}
          // Esc で入力を捨てて閉じる（バブルメニュー上のよくある操作に合わせる）。
          onKeyDown={(keyEvent) => {
            if (keyEvent.key === 'Escape') {
              keyEvent.preventDefault();
              closeForm();
            }
          }}
        >
          <input
            ref={inputRef}
            // type="url" にすると mailto: / tel: がブラウザ標準の検証で弾かれるため text にし、
            // 可否の判定は applyLink（＝許可スキームの明示リスト）に一本化する。
            type="text"
            aria-label="リンク先 URL"
            aria-invalid={invalid}
            placeholder="https://example.com"
            value={draft}
            onChange={(changeEvent) => {
              setDraft(changeEvent.target.value);
              setInvalid(false);
            }}
            className="rte-link-input"
          />
          <button type="submit" className="rte-link-action">
            適用
          </button>
          {active && (
            <button
              type="button"
              className="rte-link-action"
              onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
              onClick={handleRemove}
            >
              解除
            </button>
          )}
          {invalid && (
            <p role="alert" className="rte-link-error">
              {INVALID_MESSAGE}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
