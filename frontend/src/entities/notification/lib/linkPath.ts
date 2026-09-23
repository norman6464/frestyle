/**
 * 通知の飛び先としてリンクにしてよいパスか。
 *
 * 検査そのものは shared/lib/appPath（「ログイン後の戻り先」と同じ規則）にあり、ここは通知の
 * 語彙で名前を残すだけ。通らない値は「飛び先なし」と同じ扱い（文字だけを出す）。
 * backend の notifications.link_path の CHECK と同じ規則 —— DB が最後の砦だが、画面側でも
 * 1 回確かめる（別の backend や古いデータから来た値でも、外部へ飛ばすリンクを描かない）。
 */
export { isAppPath } from '@/shared/lib/appPath';
