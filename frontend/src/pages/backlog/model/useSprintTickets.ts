import { useCallback } from 'react';
import { useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { sprintKeys, sprintTicketIdsQuery } from '@/entities/sprint';

const NO_TICKET_IDS: Record<string, string[]> = {};

/**
 * useSprintTickets はスプリントごとの「入っているチケット ID」を持つ。
 *
 * ID だけを引き、題名や状態はバックログ一覧の応答（既に全項目が入っている）から引き当てる。
 * 中身まで別に取ると、一覧に列が増えるたびに 2 か所を直すことになる。
 *
 * スプリントごとの共有の問い合わせ（sprintTicketIdsQuery）から読むので、バックログの段と
 * スプリントのボードが同じ控えを使う（片方で入れた・外した・動かしたものがもう片方にも届く）。
 * スプリントごとの鍵なので、遅れて返った前の組み合わせの応答が今の結果に混ざらない。
 */
export function useSprintTickets(workspaceSlug: string | undefined, sprintIds: string[]) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined;
  const key = sprintIds.join(',');
  // 結果の配列をスプリント ID → チケット ID の表にまとめる。スプリントの並びが変わらない限り同じ関数。
  const combine = useCallback(
    (results: UseQueryResult<string[]>[]) => {
      const ids = key === '' ? [] : key.split(',');
      const bySprint: Record<string, string[]> = {};
      let failed = false;
      results.forEach((result, i) => {
        if (result.data !== undefined) bySprint[ids[i]] = result.data;
        else if (result.isError && !result.isFetching) failed = true;
      });
      return { bySprint: ids.length === 0 ? NO_TICKET_IDS : bySprint, failed };
    },
    [key],
  );
  const { bySprint, failed } = useQueries({
    queries: sprintIds.map((id) => ({ ...sprintTicketIdsQuery(workspaceSlug ?? '', id), enabled: active })),
    combine,
  });

  const reload = useCallback(async () => {
    if (workspaceSlug) await queryClient.invalidateQueries({ queryKey: sprintKeys.allTicketIds(workspaceSlug) });
  }, [workspaceSlug, queryClient]);

  return {
    bySprint: active ? bySprint : NO_TICKET_IDS,
    error: active && failed ? 'スプリントの中身を読み込めませんでした。' : null,
    reload,
  };
}
