/**
 * アプリ内のパスか（"/notifications" のような、同じサイトの中だけを指す文字列か）を確かめる。
 *
 * 通知の飛び先や「ログイン後に戻る先」のように、保存した文字列をそのまま遷移に使う場所で、
 * 外部サイトへの誘導（https://…・//evil.example・スラッシュ + バックスラッシュ）を弾くための最小の検査。
 * backend の notifications.link_path の CHECK と同じ条件。
 */
export function isAppPath(path: string): boolean {
  return path.startsWith('/') && !path.startsWith('//') && !path.startsWith('/\\');
}
