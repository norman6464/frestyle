import { useEffect, useId, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { Editor } from '@tiptap/react';
import { parseEmbedUrl } from './embedUrl';
import { insertEmbed } from './embedPaste';

/** 読み取れない URL を打たれたときに出す説明。受け付ける形を具体的に書く。 */
const INVALID_MESSAGE = 'YouTube の動画の URL（youtube.com/watch?v=…・youtu.be/…・youtube.com/shorts/…）を入力してください';

export interface EmbedUrlFormProps {
  editor: Editor;
  /** 置いた・取りやめた、のどちらかで閉じるときに呼ぶ。 */
  onClose: () => void;
  /** 置き場所（カーソルの下に浮かせる位置）。 */
  style?: CSSProperties;
}

/**
 * EmbedUrlForm は '/' の「埋め込み」から開く、動画の URL を入れる欄。
 *
 * 読み取れない URL は閉じずに理由を出し、そのまま直せるようにする（LinkUrlForm と同じ作法）。
 * 置く場所は欄を開いたときのカーソルの位置（エディタが覚えている）。Esc で取りやめて本文へ戻る。
 */
export default function EmbedUrlForm({ editor, onClose, style }: EmbedUrlFormProps) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const video = parseEmbedUrl(draft);
    if (video !== null && insertEmbed(editor, video)) {
      onClose();
      return;
    }
    setInvalid(true);
  };

  return (
    <form
      aria-label="埋め込みの設定"
      className="rte-embed-form"
      style={style}
      onSubmit={handleSubmit}
      onKeyDown={(keyEvent) => {
        // 変換中の Esc は変換の取り消し（Safari は isComposing ではなく keyCode 229 で知らせる）。
        if (keyEvent.key !== 'Escape' || keyEvent.nativeEvent.isComposing || keyEvent.keyCode === 229) return;
        keyEvent.preventDefault();
        keyEvent.stopPropagation();
        editor.commands.focus();
        onClose();
      }}
    >
      <div className="rte-embed-form-row">
        <input
          ref={inputRef}
          type="text"
          aria-label="埋め込む動画の URL"
          aria-invalid={invalid}
          aria-describedby={invalid ? errorId : undefined}
          placeholder="https://www.youtube.com/watch?v=…"
          value={draft}
          onChange={(changeEvent) => {
            setDraft(changeEvent.target.value);
            setInvalid(false);
          }}
          className="rte-embed-form-input"
        />
        <button type="submit" className="rte-embed-form-submit">
          埋め込む
        </button>
        <button
          type="button"
          className="rte-embed-form-cancel"
          onClick={() => {
            editor.commands.focus();
            onClose();
          }}
        >
          取りやめる
        </button>
      </div>
      {invalid && (
        <p id={errorId} role="alert" className="rte-embed-form-error">
          {INVALID_MESSAGE}
        </p>
      )}
    </form>
  );
}
