/*
 * features/ticket-cache の Public API。
 *
 * チケットを書いたあとの共有の控え（TanStack Query）の直し方。バックログ（一覧と詳細の欄）・
 * チケットの画面・ホームの作成の窓のどこで書いても、ここを通せばほかの画面の控えにも届く。
 * チケットの一覧・件数に加えてスプリントの一覧（件数つき）もまたぐので、1 つの entity には
 * 置けず feature に置く。
 */
export { reflectTicket, refreshTicketDerived, refreshTicketHierarchy } from './model/ticketCache';
