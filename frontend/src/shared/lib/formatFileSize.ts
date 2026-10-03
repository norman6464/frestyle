/**
 * バイト数を「12.3 KB」のような表示用文字列にする（1024 進数・小数第 1 位まで）。
 *
 * 添付の表示（チケットの添付の一覧・ナレッジの本文の添付）で使う。
 */
export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}
