/**
 * 一覧の行の「開く」ボタンへフォーカスを戻す。詳細を閉じたときの戻り先
 * （BacklogRow が `data-ticket-open` を付けている）。行がもう無ければ何もしない。
 *
 * 閉じる操作の直後は行の描画が終わっていないことがあるので、次のフレームで探す。
 */
export function focusTicketRow(ticketId: string): void {
  if (typeof document === 'undefined') return;
  const find = () =>
    document.querySelector<HTMLElement>(`[data-ticket-open="${CSS.escape(ticketId)}"]`);
  const target = find();
  if (target) {
    target.focus();
    return;
  }
  requestAnimationFrame(() => find()?.focus());
}
