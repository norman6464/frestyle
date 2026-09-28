/**
 * reuseUnchanged は取り直した一覧のうち、中身が前と同じものに前の値（同じ参照）を使う。
 *
 * 一覧の行は memo で、渡すチケットが同じ参照なら描き直さない。取り直しの応答は中身が同じでも
 * すべて新しい値なので、そのまま入れると絞り込みの 1 文字・再読み込みのたびに全行を描き直す。
 * 並びも要素もすべて同じなら、前の配列そのものを返す。
 *
 * 比べるのは JSON の文字列。応答の形（キーの並び）はいつも同じなので足りる。手元で書き換えた
 * 値とキーの並びが違って「違う」と判定されても、描き直しが 1 回増えるだけで表示は正しい。
 */
export function reuseUnchanged<T extends { id: string }>(prev: readonly T[], next: T[]): T[] {
  const byId = new Map(prev.map((item) => [item.id, item]));
  let sameAsPrev = prev.length === next.length;
  const merged = next.map((item, index) => {
    const old = byId.get(item.id);
    const kept = old !== undefined && (old === item || JSON.stringify(old) === JSON.stringify(item)) ? old : item;
    if (kept !== prev[index]) sameAsPrev = false;
    return kept;
  });
  return sameAsPrev ? (prev as T[]) : merged;
}
