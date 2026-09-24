import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { applyLink, removeLink } from './editorCommands';

/** 許可できない URL を打たれたときに出す説明。何が通るのかを具体的に書く。 */
const INVALID_MESSAGE = 'http:// https:// mailto: tel: のいずれかで始まる URL を入力してください';

export interface LinkUrlFormProps {
  editor: Editor;
  /** 既にリンクが掛かっていればその URL（貼り替えやすくするための初期値）。 */
  initialHref: string;
  /** キャレットの位置にリンクが掛かっているか。掛かっていれば「解除」を出す。 */
  canRemove: boolean;
  /** 適用・解除・Esc のどれかで閉じるときに呼ぶ。 */
  onClose: () => void;
  /** 置き場所の指定（バブルの下へ浮かせる・書式バーの中で改行して並べる、など）。 */
  className?: string;
}

/**
 * LinkUrlForm は「選択したテキストにリンクを掛ける」ための URL 入力欄。
 *
 * ブラウザ標準の prompt / alert は見た目も文言も差し替えられず、打ち間違えたときに入力が消えて
 * 打ち直しになる。ここでは弾かれても閉じず、理由を欄の下に出してそのまま直せるようにする。
 * ナレッジのバブルメニューとチケットの書式バーが同じ欄を使う（置き場所だけ className で変える）。
 */
export default function LinkUrlForm({ editor, initialHref, canRemove, onClose, className = '' }: LinkUrlFormProps) {
  const [draft, setDraft] = useState(initialHref);
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  // 開いた直後に入力欄へ焦点を移す（押してすぐ打ち始められるように）。
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (applyLink(editor, draft)) {
      onClose();
      return;
    }
    // 弾かれたときは閉じない。打ち直せる状態のまま理由を出す。
    setInvalid(true);
  };

  const handleRemove = () => {
    removeLink(editor);
    onClose();
  };

  return (
    <form
      aria-label="リンクの設定"
      className={`flex flex-wrap items-center gap-1 ${className}`}
      onSubmit={handleSubmit}
      onKeyDown={(keyEvent) => {
        // 変換中の Esc は変換の取り消し。欄まで閉じると打ちかけの字が消える。
        if (keyEvent.key !== 'Escape' || keyEvent.nativeEvent.isComposing) return;
        keyEvent.preventDefault();
        // 外側のダイアログやパネルが同じ Esc で閉じないよう、ここで止める。
        keyEvent.stopPropagation();
        // 入力を捨てて本文へ戻る（選択はエディタが覚えている）。
        editor.commands.focus();
        onClose();
      }}
    >
      <input
        ref={inputRef}
        // type="url" にすると mailto: / tel: がブラウザ標準の検証で弾かれるため text にし、
        // 可否の判定は applyLink（＝許可スキームの明示リスト）に一本化する。
        type="text"
        aria-label="リンク先 URL"
        aria-invalid={invalid}
        aria-describedby={invalid ? errorId : undefined}
        placeholder="https://example.com"
        value={draft}
        onChange={(changeEvent) => {
          setDraft(changeEvent.target.value);
          setInvalid(false);
        }}
        className="ui-control-compact min-w-0 flex-1 basis-48 rounded-md border border-surface-3 bg-surface-2 px-2 text-sm text-[var(--color-text-primary)] focus:border-brand-600 focus:outline-none focus:ring-1 focus:ring-brand-600 aria-[invalid=true]:border-danger"
      />
      <button
        type="submit"
        className="ui-control-compact rounded-md px-2 text-sm font-medium text-[var(--color-text-secondary)] hover:bg-surface-2 hover:text-[var(--color-text-primary)]"
      >
        適用
      </button>
      {canRemove && (
        <button
          type="button"
          className="ui-control-compact rounded-md px-2 text-sm text-[var(--color-text-secondary)] hover:bg-surface-2 hover:text-[var(--color-text-primary)]"
          // 押下でエディタから選択が外れないようにする（外れるとどこを解除するのか分からなくなる）。
          onMouseDown={(mouseEvent) => mouseEvent.preventDefault()}
          onClick={handleRemove}
        >
          解除
        </button>
      )}
      {invalid && (
        <p id={errorId} role="alert" className="basis-full text-xs text-danger-ink">
          {INVALID_MESSAGE}
        </p>
      )}
    </form>
  );
}
