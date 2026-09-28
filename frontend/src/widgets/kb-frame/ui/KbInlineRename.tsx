import { useEffect, useRef, useState } from 'react';

export interface KbInlineRenameProps {
  initialTitle: string;
  /** 入力の読み上げ名。既定は「ページの題名」（スペースの改名では「スペースの名前」を渡す）。 */
  ariaLabel?: string;
  /** 確定。**失敗は投げてくる**ので、呼び出し側が握り潰さない限り必ず表に出る。 */
  onCommit: (title: string) => Promise<void>;
  onCancel: () => void;
}

/**
 * KbInlineRename は行の題名をその場で書き換える入力欄。
 *
 * Enter で確定、Escape で取り消し、フォーカスが外れたら確定。
 * **確定に失敗したら入力欄を閉じない。** 閉じてしまうと、書いた文字は消えるのに
 * 元の題名が残り、「保存されたのか分からない」状態になる。開いたままにして
 * もう一度試せるようにする（失敗の知らせは呼び出し側が出す）。
 */
export default function KbInlineRename({
  initialTitle,
  ariaLabel = 'ページの題名',
  onCommit,
  onCancel,
}: KbInlineRenameProps) {
  const [value, setValue] = useState(initialTitle);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // 二重確定を防ぐ。Enter を押すとフォーカスも外れるので、両方が走りうる。
  const committed = useRef(false);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const commit = async () => {
    if (committed.current || saving) return;
    const title = value.trim();
    if (title === '' || title === initialTitle) {
      // 空にはできない（サーバーも弾く）。変わっていないなら投げる必要も無い。
      onCancel();
      return;
    }
    committed.current = true;
    setSaving(true);
    try {
      await onCommit(title);
    } catch {
      // 開いたままにして、もう一度試せるようにする。知らせは呼び出し側が出す。
      committed.current = false;
      setSaving(false);
      inputRef.current?.focus();
      return;
    }
    setSaving(false);
  };

  return (
    <input
      ref={inputRef}
      type="text"
      value={value}
      disabled={saving}
      aria-label={ariaLabel}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        // 日本語入力の変換確定 Enter は入力欄の確定ではない。isComposing を見ないと、
        // 変換のたびに打ちかけの題名でリネームが飛ぶ（keyCode 229 は Safari の変換中の値）。
        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
        if (event.key === 'Enter') {
          event.preventDefault();
          void commit();
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          committed.current = true; // このあと走る onBlur に確定させない
          onCancel();
        }
      }}
      className="min-w-0 flex-1 rounded border border-brand-600 bg-surface-1 px-1 py-0.5 text-sm text-[var(--color-text-primary)] focus:outline-none"
    />
  );
}
