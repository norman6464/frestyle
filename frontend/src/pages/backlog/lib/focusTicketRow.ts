/**
 * 一覧の行の「開く」ボタンへフォーカスを戻す。詳細を閉じたときの戻り先
 * （BacklogRow が `data-ticket-open` を付けている）。行がもう無ければ何もしない。
 *
 * 閉じる操作の直後は、行の描画が終わっていないか、一覧がまだ inert のまま（狭い画面の全画面の
 * 詳細を閉じた同じ処理の中では、一覧の inert が外れるのは次の描画）のことがある。その間の
 * focus() は効かないので、フォーカスが移らなかったときは次のフレームでもう一度試す。
 */
export function focusTicketRow(ticketId: string): void {
  if (typeof document === 'undefined') return;
  const find = () =>
    document.querySelector<HTMLElement>(`[data-ticket-open="${CSS.escape(ticketId)}"]`);
  const target = find();
  if (target) {
    target.focus();
    if (document.activeElement === target) return;
  }
  requestAnimationFrame(() => find()?.focus());
}
