import { useState, type ReactNode } from 'react';

export interface BlankableFieldProps {
  /** いまの値。null／空文字なら未設定として案内文を出す。 */
  value: string | null;
  /** 未設定のときに出す案内文（例「期限を追加してください」）。 */
  placeholder: string;
  /** 変更を受け付けるか。false なら値か案内文を読むだけ。 */
  editable: boolean;
  /**
   * 実際の入力欄。`autoFocus` は押して開いた直後だけ true（開いてすぐ打てるように）。
   * `done` を onBlur に繋ぐと、離れたときに読み取りの見た目へ戻る。
   */
  render: (autoFocus: boolean, done: () => void) => ReactNode;
}

/**
 * 値を読んでいる状態から、その場で編集へ切り替える項目。
 *
 * 入力欄を最初から出すと、まだ何も入っていない項目まで枠だらけになり、
 * 「読む項目」と「これから入れる項目」の区別が付かなくなる。日付や数値のように
 * ブラウザ既定の見た目が強い型ほど差が大きいので、空のうちは文字だけを置く。
 */
export default function BlankableField({ value, placeholder, editable, render }: BlankableFieldProps) {
  const [editing, setEditing] = useState(false);
  const filled = value !== null && value !== '';

  if (editing && editable) return <>{render(true, () => setEditing(false))}</>;

  if (!editable) {
    return filled ? <span>{value}</span> : <span className="text-[var(--color-text-muted)]">未設定</span>;
  }

  return (
    /*
     * 未設定は「値」ではなく「入れられる場所」。点線の下線を足して、入っている値と
     * 見分けが付くようにする（色を薄くするだけだと、薄い値なのか空なのか読めない）。
     */
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`-mx-1 min-h-6 rounded px-1 py-0.5 text-left transition-colors [@media(pointer:coarse)]:min-h-11 duration-fast hover:bg-surface-2 ${
        filled
          ? 'text-[var(--color-text-primary)]'
          : 'text-[var(--color-text-muted)] underline decoration-dotted underline-offset-4'
      }`}
    >
      {filled ? value : placeholder}
    </button>
  );
}
