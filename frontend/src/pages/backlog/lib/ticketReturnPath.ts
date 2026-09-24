/**
 * 全画面の票の「戻る」の行き先と文言（設計ボード PX03）。
 *
 * 票を開いた画面は、開くときに `location.state.from` へ自分の場所（条件つきの URL）を載せる
 * （ticketLinkState。ホーム・自分の担当・バックログ）。それがあればそこへ戻り、無ければ
 * そのチケットのプロジェクトのバックログへ、そのチケットを選んだ状態で戻る
 * （通知・本文中の参照・ブックマークから来た場合）。
 *
 * `from` は同じサイトの中の経路だけを受ける（`//` で始まる別のサイトや、http から始まる
 * 文字列は使わない）。state は画面の外から差し込めないが、形の壊れた値で迷子にしない。
 */
export interface TicketReturnPath {
  to: string;
  label: string;
}

export function ticketReturnPath(from: unknown, projectId: string, ticketId: string): TicketReturnPath {
  if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')) {
    if (from === '/') return { to: from, label: 'ホームに戻る' };
    if (from === '/assigned' || from.startsWith('/assigned?')) return { to: from, label: '自分の担当に戻る' };
    if (from.startsWith('/backlog/')) return { to: from, label: 'バックログに戻る' };
  }
  return {
    to: `/backlog/${encodeURIComponent(projectId)}?ticket=${encodeURIComponent(ticketId)}`,
    label: 'バックログ',
  };
}
