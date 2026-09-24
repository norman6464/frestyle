import { useCallback, useEffect, useRef, useState } from 'react';
import { TicketRepository, type TicketSavedFilter, type TicketSavedFilterInput } from '@/entities/ticket';

const LOAD_FAILED = '保存した絞り込みを読み込めませんでした。';

interface SavedFiltersTarget {
  key: string;
  workspaceSlug: string;
  projectId: string;
}

function targetOf(workspaceSlug: string | undefined, projectId: string | undefined): SavedFiltersTarget | null {
  if (!workspaceSlug || !projectId) return null;
  return { key: `${workspaceSlug} ${projectId}`, workspaceSlug, projectId };
}

/**
 * useSavedFilters は本人がそのプロジェクトで保存した絞り込み（名前・条件・件数）を読み書きする。
 *
 * 件数は backend が絞り込みごとに数えて一覧に添えてくる（「自分の担当」の主体の解決が要り、
 * フロントでは計算しない）。チケットを動かしたあとは `refresh` で一覧ごと取り直す —
 * 名前は変わらないので、実質は件数の取り直し。
 *
 * 取り直しに失敗しても、既に見えている名前は消さない（押せば条件は URL から再現できる）。
 * 代わりに `countsFailed` を立て、画面は数字の代わりに「—」を出す（古い数字を出したままだと
 * 「変えたのに減らない」と読まれる）。最初の取得の失敗だけは `error` にする。
 */
export function useSavedFilters(workspaceSlug: string | undefined, projectId: string | undefined) {
  const [filters, setFilters] = useState<TicketSavedFilter[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [countsFailed, setCountsFailed] = useState(false);
  const active = useRef<SavedFiltersTarget | null>(null);
  const seq = useRef(0);
  const hasList = useRef(false);

  const target = targetOf(workspaceSlug, projectId);
  const targetKey = target?.key ?? null;

  const load = useCallback(async (to: SavedFiltersTarget) => {
    const request = ++seq.current;
    // 一度でも読めていれば、取り直し中も一覧を消さない（名前が点滅すると押せない瞬間ができる）。
    if (!hasList.current) setLoading(true);
    setError(null);
    try {
      const list = await TicketRepository.fetchSavedFilters(to.workspaceSlug, to.projectId);
      if (active.current?.key !== to.key || seq.current !== request) return;
      hasList.current = true;
      setFilters(list);
      setCountsFailed(false);
      setLoading(false);
    } catch {
      if (active.current?.key !== to.key || seq.current !== request) return;
      setLoading(false);
      if (hasList.current) setCountsFailed(true);
      else setError(LOAD_FAILED);
    }
  }, []);

  useEffect(() => {
    active.current = target;
    hasList.current = false;
    if (!target) {
      seq.current += 1;
      setFilters([]);
      setError(null);
      setCountsFailed(false);
      return;
    }
    void load(target);
    // target は毎描画で作り直すオブジェクトなので、鍵で比べる（useTicketList と同じ形）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, load]);

  const refresh = useCallback(() => {
    if (active.current) void load(active.current);
  }, [load]);

  const requireTarget = useCallback((): SavedFiltersTarget => {
    if (!active.current) throw new Error('backlog: no active target');
    return active.current;
  }, []);

  /** 名前を付けて保存する。応答（件数付き）を末尾に足して返す。 */
  const create = useCallback(
    async (input: TicketSavedFilterInput) => {
      const to = requireTarget();
      const created = await TicketRepository.createSavedFilter(to.workspaceSlug, to.projectId, input);
      if (active.current?.key === to.key) {
        hasList.current = true;
        setFilters((prev) => [...prev, created]);
      }
      return created;
    },
    [requireTarget],
  );

  /**
   * 名前だけを変える。PUT は名前と条件を丸ごと差し替えるので、条件は手元の値をそのまま送る
   * （送らないと条件が消える）。
   */
  const rename = useCallback(
    async (filter: TicketSavedFilter, name: string) => {
      const to = requireTarget();
      const updated = await TicketRepository.updateSavedFilter(to.workspaceSlug, to.projectId, filter.id, {
        name,
        statusId: filter.statusId,
        typeId: filter.typeId,
        labelId: filter.labelId,
        assigneePrincipalId: filter.assigneePrincipalId,
        unassigned: filter.unassigned,
        assignedToMe: filter.assignedToMe,
        overdue: filter.overdue,
        q: filter.q,
      });
      if (active.current?.key === to.key) {
        setFilters((prev) => prev.map((f) => (f.id === filter.id ? updated : f)));
      }
      return updated;
    },
    [requireTarget],
  );

  const remove = useCallback(
    async (filterId: string) => {
      const to = requireTarget();
      await TicketRepository.deleteSavedFilter(to.workspaceSlug, to.projectId, filterId);
      if (active.current?.key === to.key) setFilters((prev) => prev.filter((f) => f.id !== filterId));
    },
    [requireTarget],
  );

  return { filters, loading, error, countsFailed, refresh, create, rename, remove };
}
