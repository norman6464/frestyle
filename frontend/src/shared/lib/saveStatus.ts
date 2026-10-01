/**
 * SaveStatus はエディタ本文の保存状態。
 * 保存の実処理（debounce・PUT・楽観ロック）は画面側が持ち、表示の部品は状態を受け取るだけ。
 */
export type SaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved';

/** 保存状態の呼び名。エディタの下の表示と、ページのバイラインの表示で同じ言葉を使う。 */
export const SAVE_STATUS_LABEL: Record<Exclude<SaveStatus, 'idle'>, string> = {
  unsaved: '未保存',
  saving: '保存中...',
  saved: '保存済み',
};
