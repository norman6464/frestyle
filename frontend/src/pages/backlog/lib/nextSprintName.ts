/**
 * 新しく作るスプリントの既定の名前（「スプリント N」）。
 *
 * N は件数 + 1 から始め、同じ名前が既にあれば空くまで進める。件数だけで決めると、途中の
 * スプリントを消した後（1・3 が残る）に「スプリント 3」がもう 1 本できてしまう。
 * バックログの段からすぐ作るときと、設定の面の名前の欄の初期値で同じ規則を使う。
 */
export function nextSprintName(existing: ReadonlyArray<{ name: string }>): string {
  const taken = new Set(existing.map((sprint) => sprint.name.trim()));
  let n = existing.length + 1;
  while (taken.has(`スプリント ${n}`)) n += 1;
  return `スプリント ${n}`;
}
