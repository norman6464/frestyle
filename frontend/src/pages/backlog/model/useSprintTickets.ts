import { useCallback, useEffect, useRef, useState } from 'react';
import { SprintRepository } from '@/entities/sprint';

/**
 * useSprintTickets はスプリントごとの「入っているチケット ID」を持つ。
 *
 * ID だけを引き、題名や状態はバックログ一覧の応答（既に全項目が入っている）から引き当てる。
 * 中身まで別に取ると、一覧に列が増えるたびに 2 か所を直すことになる。
 */
export function useSprintTickets(workspaceSlug: string | undefined, sprintIds: string[]) {
  const [bySprint, setBySprint] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const key = sprintIds.join(',');
  // 読み込みの世代。遅れて返ってきた古い応答で新しい結果を上書きしないための番号。
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    if (!workspaceSlug || sprintIds.length === 0) {
      setBySprint({});
      setError(null);
      return;
    }
    try {
      const entries = await Promise.all(
        sprintIds.map(async (id) => [id, await SprintRepository.fetchSprintTicketIds(workspaceSlug, id)] as const),
      );
      if (seq.current !== mine) return;
      setBySprint(Object.fromEntries(entries));
      setError(null);
    } catch {
      if (seq.current !== mine) return;
      // 握り潰さない。**どのチケットがどのスプリントに入っているかが分からないまま
      // 描くと、スプリントの中身が空になり、そのチケットがバックログ側に並ぶ** ——
      // 間違った場所に居るのに、間違っていると分からない見え方になる。
      setBySprint({});
      setError('スプリントの中身を読み込めませんでした。');
    }
    // sprintIds は配列なので、中身が同じでも参照が変わる。文字列に畳んだ key で見る。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceSlug, key]);

  useEffect(() => {
    void load();
  }, [load]);

  return { bySprint, error, reload: load };
}
