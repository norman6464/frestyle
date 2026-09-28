import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { queryShownState } from '@/shared/api/queryState';
import {
  TicketRepository,
  savedFiltersQuery,
  type TicketSavedFilter,
  type TicketSavedFilterInput,
} from '@/entities/ticket';

const LOAD_FAILED = '保存した絞り込みを読み込めませんでした。';
const NO_FILTERS: TicketSavedFilter[] = [];

/**
 * useSavedFilters は本人がそのプロジェクトで保存した絞り込み（名前・条件・件数）を読み書きする。
 *
 * 件数は backend が絞り込みごとに数えて一覧に添えてくる（「自分の担当」の主体の解決が要り、
 * フロントでは計算しない）。一覧は共有の問い合わせ（savedFiltersQuery）から読み、チケットを
 * 動かしたら書き込みの側（refreshTicketDerived）が古いものにして取り直させる — 名前は変わらない
 * ので、実質は件数の取り直し。作成・改名・削除の応答は reflectWrite で一覧へ映す。
 *
 * 取り直しに失敗しても、既に見えている名前は消さない（押せば条件は URL から再現できる）。
 * 代わりに `countsFailed` を立て、画面は数字の代わりに「—」を出す（古い数字を出したままだと
 * 「変えたのに減らない」と読まれる）。最初の取得の失敗だけは `error` にする。
 */
export function useSavedFilters(workspaceSlug: string | undefined, projectId: string | undefined) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined && projectId !== undefined;
  const result = useQuery({ ...savedFiltersQuery(workspaceSlug ?? '', projectId ?? ''), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);
  // 名前を持っているうちの取り直しの失敗は、名前を出したまま件数だけ「—」にする。
  const countsFailed = data !== undefined && result.isError && !result.isFetching;

  const { refetch } = result;
  const refresh = useCallback(() => {
    if (active) void refetch();
  }, [active, refetch]);

  const requireTarget = useCallback((): [string, string] => {
    if (!workspaceSlug || !projectId) throw new Error('backlog: no active target');
    return [workspaceSlug, projectId];
  }, [workspaceSlug, projectId]);

  /** 名前を付けて保存する。応答（件数付き）を末尾に足して返す。 */
  const create = useCallback(
    async (input: TicketSavedFilterInput) => {
      const [slug, project] = requireTarget();
      const created = await TicketRepository.createSavedFilter(slug, project, input);
      await reflectWrite(queryClient, savedFiltersQuery(slug, project).queryKey, (prev) =>
        prev.some((f) => f.id === created.id) ? prev : [...prev, created],
      );
      return created;
    },
    [requireTarget, queryClient],
  );

  /**
   * 名前だけを変える。PUT は名前と条件を丸ごと差し替えるので、条件は手元の値をそのまま送る
   * （送らないと条件が消える）。
   */
  const rename = useCallback(
    async (filter: TicketSavedFilter, name: string) => {
      const [slug, project] = requireTarget();
      const updated = await TicketRepository.updateSavedFilter(slug, project, filter.id, {
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
      await reflectWrite(queryClient, savedFiltersQuery(slug, project).queryKey, (prev) =>
        prev.map((f) => (f.id === filter.id ? updated : f)),
      );
      return updated;
    },
    [requireTarget, queryClient],
  );

  const remove = useCallback(
    async (filterId: string) => {
      const [slug, project] = requireTarget();
      await TicketRepository.deleteSavedFilter(slug, project, filterId);
      await reflectWrite(queryClient, savedFiltersQuery(slug, project).queryKey, (prev) =>
        prev.filter((f) => f.id !== filterId),
      );
    },
    [requireTarget, queryClient],
  );

  return {
    filters: data ?? NO_FILTERS,
    loading,
    error: failed ? LOAD_FAILED : null,
    countsFailed,
    refresh,
    create,
    rename,
    remove,
  };
}
