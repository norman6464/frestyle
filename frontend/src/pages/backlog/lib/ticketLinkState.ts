import type { Location } from 'react-router-dom';

/**
 * 全画面の票（/tickets/:id）へのリンクに載せる state。票の「戻る」の行き先（ticketReturnPath）の元。
 *
 * 票の中から別の票へ移るとき（親・子・発言の「すべて見る」）は、いま持っている出発点をそのまま
 * 引き継ぐ（票から票へ渡っても、戻るのは最初に開いた一覧）。それ以外の画面からはその画面の
 * 場所（条件つきの URL）を出発点にする。
 */
export function ticketLinkState(location: Pick<Location, 'pathname' | 'search' | 'state'>): { from?: unknown } {
  if (location.pathname.startsWith('/tickets/')) {
    const from = (location.state as { from?: unknown } | null)?.from;
    return from === undefined ? {} : { from };
  }
  return { from: `${location.pathname}${location.search}` };
}
