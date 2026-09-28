import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { queryShownState } from '@/shared/api/queryState';
import { TicketRepository, ticketWatchQuery, type TicketWatchState } from '@/entities/ticket';

/**
 * useTicketWatch は自分がそのチケットを監視しているかと、監視している人数を読み書きする。
 *
 * 共有の問い合わせ（ticketWatchQuery）から読み、チケットごとの鍵なので、別のチケットへ移ったら
 * 前のチケットの状態は出さない。今のチケットの状態がまだ無い間（取得中・取れなかった）は
 * `watch` が null。送るのは「切り替え」ではなく「どちらにしたいか」で、返ってきた状態を映す
 * （二重に押されたときに意図せず外れない）。失敗は投げる（呼び出し側が知らせる）。
 */
export function useTicketWatch(workspaceSlug: string, ticketId: string) {
  const queryClient = useQueryClient();
  const result = useQuery(ticketWatchQuery(workspaceSlug, ticketId));
  const watch: TicketWatchState | null = queryShownState(result).data ?? null;
  // 送っている間は、どのチケットへの送信かと組で持つ（別のチケットへ移ったら押せる状態に戻す）。
  const [sendingFor, setSendingFor] = useState<string | null>(null);
  const busy = sendingFor === ticketId;

  const setWatching = useCallback(
    async (watching: boolean) => {
      setSendingFor(ticketId);
      try {
        const next = await TicketRepository.setTicketWatching(workspaceSlug, ticketId, watching);
        await reflectWrite(queryClient, ticketWatchQuery(workspaceSlug, ticketId).queryKey, () => next);
      } finally {
        setSendingFor((prev) => (prev === ticketId ? null : prev));
      }
    },
    [workspaceSlug, ticketId, queryClient],
  );

  return { watch, busy, setWatching };
}
