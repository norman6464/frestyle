import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { reflectWrite } from '@/shared/api/queryCache';
import { TicketRepository, ticketLabelsQuery, type Label, type LabelInput } from '@/entities/ticket';

const LOAD_FAILED = 'ラベルを読み込めませんでした。時間をおいて開き直すと最新の状態が出ます。';
const NO_LABELS: Label[] = [];

/**
 * useTicketLabels はワークスペースのラベル定義（一覧・作成・改名・削除）を読み書きする。
 *
 * ラベルの語彙はワークスペース単位（ページとチケットで共有する）ので、プロジェクトを
 * 切り替えても同じ一覧が出る。一覧は共有の問い合わせ（ticketLabelsQuery）から読むので、
 * バックログとチケットの画面を行き来しても取り直さず、片方で作ったラベルはもう片方にも出る。
 *
 * 状態・種別のマスタ（useTicketMasters）と違い、使用中件数のような取得し直さないと
 * ずれる派生値を持たないので、作成・更新・削除の応答をそのまま共有の一覧へ反映する
 * （マスタのように毎回一覧を取り直さない）。
 *
 * チケットへの付け外し（ticket.labels の更新）はここでは持たない — 対象がチケット
 * 1 件の状態（useTicketList / useTicketPage）に属するため、それぞれの hook に持たせる。
 */
export function useTicketLabels(workspaceSlug: string | undefined) {
  const queryClient = useQueryClient();
  const result = useQuery({ ...ticketLabelsQuery(workspaceSlug ?? ''), enabled: workspaceSlug !== undefined });
  const view = queryShownState(result, workspaceSlug !== undefined);

  const { refetch } = result;
  const refresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const requireScope = useCallback((): string => {
    if (!workspaceSlug) throw new Error('backlog: no active scope');
    return workspaceSlug;
  }, [workspaceSlug]);

  const createLabel = useCallback(
    async (input: LabelInput) => {
      const slug = requireScope();
      const created = await TicketRepository.createLabel(slug, input);
      await reflectWrite(queryClient, ticketLabelsQuery(slug).queryKey, (prev) =>
        prev.some((l) => l.id === created.id) ? prev : [...prev, created],
      );
      return created;
    },
    [requireScope, queryClient],
  );

  const updateLabel = useCallback(
    async (labelId: string, input: LabelInput) => {
      const slug = requireScope();
      const updated = await TicketRepository.updateLabel(slug, labelId, input);
      await reflectWrite(queryClient, ticketLabelsQuery(slug).queryKey, (prev) =>
        prev.map((l) => (l.id === labelId ? updated : l)),
      );
      return updated;
    },
    [requireScope, queryClient],
  );

  const deleteLabel = useCallback(
    async (labelId: string) => {
      const slug = requireScope();
      await TicketRepository.deleteLabel(slug, labelId);
      await reflectWrite(queryClient, ticketLabelsQuery(slug).queryKey, (prev) => prev.filter((l) => l.id !== labelId));
    },
    [requireScope, queryClient],
  );

  return {
    labels: view.data ?? NO_LABELS,
    loading: view.loading,
    error: view.failed ? LOAD_FAILED : null,
    refresh,
    createLabel,
    updateLabel,
    deleteLabel,
  };
}
