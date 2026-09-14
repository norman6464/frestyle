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
 * 束ねる鍵は状態の名前。並べ替えは backend が済ませている（状態の枠 → 状態の並び →
 * 期限）ので、ここで並べ直さない —— 並びの規則を 2 か所に分けると、片方だけ直したときに
 * 順序が黙ってずれる。
 *
 * ただし backend が並べているのは**ワークスペース 1 つ分**まで。それを繋げると同じ状態名が
 * 離れた位置に何度も現れるので、「隣り合っていたら同じ束」では見出しが重複する
 * （「進行中」が 2 回出る）。名前で引き当てて束ね直し、見出しの順は最初に出てきた順にする。
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
      const byName = new Map<string, AssignedGroup>();
      for (const ticket of tickets) {
        const found = byName.get(ticket.statusName);
        if (found) {
          found.tickets.push(ticket);
          continue;
        }
        const group: AssignedGroup = {
          name: ticket.statusName,
          category: ticket.statusCategory,
          color: ticket.statusColor,
          tickets: [ticket],
        };
        byName.set(ticket.statusName, group);
        next.push(group);
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
