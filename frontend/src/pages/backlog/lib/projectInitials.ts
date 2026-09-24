/**
 * プロジェクトの角の印に出す 2 文字。プロジェクトの鍵（チケットキーの接頭辞。APP-12 の
 * APP）から取る —— 名前と違って改名で変わらず、チケットのキーとも揃う。自動採番の鍵
 * （p-1a2b3c）は記号を落としてから 2 文字取る。
 */
export function projectInitials(key: string): string {
  const letters = key.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || key.slice(0, 2)).toUpperCase();
}
