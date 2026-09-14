import { useCallback, useEffect, useState } from 'react';
import { SprintRepository } from '@/entities/sprint';

/**
 * useSprintTickets はスプリントごとの「入っているチケット ID」を持つ。
 *
 * ID だけを引き、題名や状態はバックログ一覧の応答（既に全項目が入っている）から引き当てる。
 * 中身まで別に取ると、一覧に列が増えるたびに 2 か所を直すことになる。
 */
export function useSprintTickets(workspaceSlug: string | undefined, sprintIds: string[]) {
  const [bySprint, setBySprint] = useState<Record<string, string[]>>({});
  const key = sprintIds.join(',');

  const load = useCallback(async () => {
    if (!workspaceSlug || sprintIds.length === 0) {
      setBySprint({});
      return;
    }
    const entries = await Promise.all(
      sprintIds.map(async (id) => [id, await SprintRepository.fetchSprintTicketIds(workspaceSlug, id)] as const),
    );
    setBySprint(Object.fromEntries(entries));
    // sprintIds は配列なので、中身が同じでも参照が変わる。文字列に畳んだ key で見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, key]);

  useEffect(() => {
    void load();
  }, [load]);

  return { bySprint, reload: load };
}
