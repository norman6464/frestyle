/**
 * 通知の飛び先としてリンクにしてよいパスか。
 *
 * アプリ内の相対パス（スラッシュ 1 つで始まる）だけを通す。"//evil.example" はスキーム相対の
 * 外部 URL、"/\\evil" はブラウザが "//" と同じに解釈するので、どちらも弾く。
 * backend の notifications.link_path の CHECK と同じ規則 —— DB が最後の砦だが、画面側でも
 * 1 回確かめる（別の backend や古いデータから来た値でも、外部へ飛ばすリンクを描かない）。
 * 通らない値は「飛び先なし」と同じ扱い（文字だけを出す）。
 */
export function isAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}
