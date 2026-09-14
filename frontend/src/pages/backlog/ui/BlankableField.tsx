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
 * 「押すまで文字、押したら入力欄」の項目（見本の Jira と同じ振る舞い）。
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
    return filled ? <span>{value}</span> : <span className="text-[var(--color-text-muted)]">{placeholder}</span>;
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className={`-mx-1 rounded px-1 py-0.5 text-left hover:bg-surface-2 ${
        filled ? '' : 'text-[var(--color-text-muted)]'
      }`}
    >
      {filled ? value : placeholder}
    </button>
  );
}
