import { useQuery } from '@tanstack/react-query';
import { myAssignedTicketsQuery, type MyAssignedTicket } from '@/entities/ticket';
import { toHomeResource, type HomeResource } from './homeResource';

/** 広い画面で並べる件数（狭い画面はこのうち先頭の 2 件）。 */
export const ASSIGNED_PREVIEW_LIMIT = 3;

const EMPTY: MyAssignedTicket[] = [];

/**
 * 自分の担当（全ワークスペース横断・未完了・期限の近い順・上限つき）。並びと上限はサーバーが
 * 決めるので、ここでは並べ替えない（緊急度や重要度を画面で推測しない）。チケットを書き換えたら
 * 古いものになり、次にホームを開いたときに取り直す。
 */
export function useMyAssignedTickets(): HomeResource<MyAssignedTicket[]> {
  return toHomeResource(useQuery(myAssignedTicketsQuery(ASSIGNED_PREVIEW_LIMIT)), EMPTY);
}
