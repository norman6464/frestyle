import { useCallback, useEffect, useState } from 'react';
import { KbRepository } from '@/entities/kb';
import { TicketRepository, type AssignedTicket } from '@/entities/ticket';

export interface AssignedGroup {
  /** 状態の名前（'進行中' など）。束ねる見出しに出す。 */
  name: string;
  /** 'todo' | 'in_progress' | 'done'。見出しの色の判断に使う。 */
  category: string;
  color: string;
  tickets: AssignedTicket[];
}

/**
 * 自分に割り当たっているチケットを取り、**状態ごとに束ねて**返す。
 *
 * 束ねる境目は「返ってきた順のまま、状態名が変わったところ」。並べ替えは backend が
 * 済ませている（状態の枠 → 状態の並び → 期限）ので、ここで並べ直さない —— 並びの規則を
 * 2 か所に分けると、片方だけ直したときに順序が黙ってずれる。
 *
 * 所属するワークスペースすべてを横断して集める。API はワークスペース 1 つ分を返す口なので、
 * ここで順に呼んで束ね直す（resolveBacklogProject と同じ理由——projectId や「全部」を
 * 直接引く口が backend に無い。ワークスペース数は実データで数個なので、いまはこれで足りる）。
 */
export function useAssignedTickets() {
  const [groups, setGroups] = useState<AssignedGroup[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const workspaces = await KbRepository.fetchWorkspaces();
      const perWorkspace = await Promise.all(
        workspaces.map((workspace) => TicketRepository.fetchAssignedTickets(workspace.slug)),
      );
      const tickets = perWorkspace.flat();
      const next: AssignedGroup[] = [];
      for (const ticket of tickets) {
        const last = next[next.length - 1];
        if (last && last.name === ticket.statusName) {
          last.tickets.push(ticket);
          continue;
        }
        next.push({
          name: ticket.statusName,
          category: ticket.statusCategory,
          color: ticket.statusColor,
          tickets: [ticket],
        });
      }
      setGroups(next);
      setTotal(tickets.length);
    } catch {
      setError('担当の一覧を取得できませんでした。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return { groups, total, loading, error, reload: load };
}
