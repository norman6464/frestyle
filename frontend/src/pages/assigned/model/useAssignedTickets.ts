import { useCallback, useMemo } from 'react';
import { useQueries, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { kbKeys, kbWorkspacesQuery, type KbWorkspace } from '@/entities/kb';
import { assignedTicketsQuery, type AssignedTicket } from '@/entities/ticket';

export interface AssignedGroup {
  /** 状態の名前（'進行中' など）。束ねる見出しに出す。 */
  name: string;
  /** 'todo' | 'in_progress' | 'done'。見出しの色の判断に使う。 */
  category: string;
  color: string;
  tickets: AssignedTicket[];
}

const NO_WORKSPACES: KbWorkspace[] = [];
const LOAD_FAILED = '担当の一覧を取得できませんでした。';

/** ワークスペースごとの結果を、まとめた取り具合と全部のチケットにする（結果が同じなら同じ物を返す）。 */
function combineAssigned(results: UseQueryResult<AssignedTicket[]>[]) {
  const settledMissing = (r: UseQueryResult<AssignedTicket[]>) => r.data === undefined && r.isError && !r.isFetching;
  return {
    waiting: results.some((r) => r.data === undefined && !settledMissing(r)),
    failed: results.some(settledMissing),
    tickets: results.flatMap((r) => r.data ?? []),
  };
}

/** 状態の名前で引き当てて束ねる。見出しの順は最初に出てきた順。 */
function groupByStatus(tickets: AssignedTicket[]): AssignedGroup[] {
  const groups: AssignedGroup[] = [];
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
    groups.push(group);
  }
  return groups;
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
 * ワークスペースごとの共有の問い合わせ（assignedTicketsQuery）を並べて取り、束ね直す（projectId や
 * 「全部」を直接引く口が backend に無い。ワークスペース数は実データで数個なので、いまはこれで足りる）。
 * すべてのワークスペースの分がそろうまでは読み込み中、どれかが読めなければ失敗（一部だけで束ねて
 * 「これで全部」に見せない）。
 */
export function useAssignedTickets() {
  const queryClient = useQueryClient();
  const workspaces = useQuery(kbWorkspacesQuery());
  const list = workspaces.data ?? NO_WORKSPACES;
  const { waiting, failed, tickets } = useQueries({
    queries: list.map((workspace) => assignedTicketsQuery(workspace.slug)),
    combine: combineAssigned,
  });
  const groups = useMemo(() => groupByStatus(tickets), [tickets]);

  const workspacesFailed = workspaces.data === undefined && workspaces.isError && !workspaces.isFetching;
  const loading = !workspacesFailed && (workspaces.data === undefined || waiting);
  const error = workspacesFailed || failed ? LOAD_FAILED : null;

  // 読めなかった一覧だけを取り直す（読めている一覧まで取り直して待たせない）。
  const reload = useCallback(async () => {
    await queryClient.refetchQueries({
      queryKey: kbKeys.workspaces(),
      type: 'active',
      predicate: (query) => query.state.status === 'error',
    });
  }, [queryClient]);

  return { groups, total: tickets.length, loading, error, reload };
}
