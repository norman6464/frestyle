import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import {
  SprintRepository,
  sprintKeys,
  sprintListQuery,
  type Sprint,
  type SprintInput,
  type SprintState,
} from '@/entities/sprint';

const NO_SPRINTS: Sprint[] = [];

/**
 * useSprints はプロジェクトのスプリント一覧と、その操作をまとめる。
 *
 * 一覧は共有の問い合わせ（sprintListQuery）から読む。プロジェクトごとの鍵なので、切り替えた直後の
 * 描画や切り替え先の取得に失敗したときに、前のプロジェクトのスプリントを出さない。
 *
 * 操作のあとは必ず一覧を取り直し、取り直しを待ってから返す。件数（ticketCount）や状態は backend が
 * 決めるので、手元で組み立て直すと「画面では開始したのに実際は弾かれていた」がありうる
 * （進行中は 1 つまで・終わったスプリントには足せない、といった規則は backend が持つ）。
 * チケットを入れた・外した・動かしたときは、スプリントの中身（チケット ID）とチケットの入っている
 * スプリントも古いものにする（バックログの段・スプリントのボード・詳細の欄が同じ控えを使う）。
 */
export function useSprints(workspaceSlug: string | undefined, projectId: string | undefined) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined && projectId !== undefined;
  const result = useQuery({ ...sprintListQuery(workspaceSlug ?? '', projectId ?? ''), enabled: active });
  const { data, loading, failed } = queryShownState(result, active);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { refetch } = result;
  const reload = useCallback(async () => {
    if (active) await refetch();
  }, [active, refetch]);

  /** 一覧を取り直させる（見ている間は取り直しを待つ）。 */
  const refreshList = useCallback(
    (slug: string, project: string) => queryClient.invalidateQueries({ queryKey: sprintKeys.list(slug, project) }),
    [queryClient],
  );

  /** スプリントの中身とチケットの入っているスプリントを古いものにする。 */
  const refreshMembership = useCallback(
    (slug: string) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: sprintKeys.allTicketIds(slug) }),
        queryClient.invalidateQueries({ queryKey: sprintKeys.allTicketSprints(slug) }),
      ]),
    [queryClient],
  );

  const create = useCallback(
    async (input: SprintInput) => {
      if (!workspaceSlug || !projectId) return;
      await SprintRepository.createSprint(workspaceSlug, projectId, input);
      await refreshList(workspaceSlug, projectId);
    },
    [workspaceSlug, projectId, refreshList],
  );

  /** 1 つのスプリントへの操作。押したスプリントの行を閉じ、終わったら一覧を取り直す。 */
  const operate = useCallback(
    async (sprintId: string, run: (slug: string) => Promise<unknown>) => {
      if (!workspaceSlug || !projectId) return;
      setBusyId(sprintId);
      try {
        await run(workspaceSlug);
        await refreshList(workspaceSlug, projectId);
      } finally {
        setBusyId(null);
      }
    },
    [workspaceSlug, projectId, refreshList],
  );

  const update = useCallback(
    (sprintId: string, input: SprintInput) =>
      operate(sprintId, (slug) => SprintRepository.updateSprint(slug, sprintId, input)),
    [operate],
  );

  const changeState = useCallback(
    (sprintId: string, state: SprintState) =>
      operate(sprintId, (slug) => SprintRepository.changeSprintState(slug, sprintId, state)),
    [operate],
  );

  const remove = useCallback(
    async (sprintId: string) => {
      await operate(sprintId, (slug) => SprintRepository.deleteSprint(slug, sprintId));
      if (workspaceSlug) await refreshMembership(workspaceSlug);
    },
    [operate, workspaceSlug, refreshMembership],
  );

  /** チケットをスプリントへ入れる（別のスプリントに居れば移動）。 */
  const addTicket = useCallback(
    async (sprintId: string, ticketId: string) => {
      if (!workspaceSlug || !projectId) return;
      await SprintRepository.addTicketToSprint(workspaceSlug, sprintId, ticketId);
      await Promise.all([refreshList(workspaceSlug, projectId), refreshMembership(workspaceSlug)]);
    },
    [workspaceSlug, projectId, refreshList, refreshMembership],
  );

  /** チケットをスプリントから外す（バックログへ戻る）。 */
  const removeTicket = useCallback(
    async (ticketId: string) => {
      if (!workspaceSlug || !projectId) return;
      await SprintRepository.removeTicketFromSprint(workspaceSlug, ticketId);
      await Promise.all([refreshList(workspaceSlug, projectId), refreshMembership(workspaceSlug)]);
    },
    [workspaceSlug, projectId, refreshList, refreshMembership],
  );

  /** スプリント内で 1 つ動かす（anchor の手前／直後へ）。 */
  const moveTicket = useCallback(
    async (ticketId: string, anchorTicketId: string, anchorAfter: boolean) => {
      if (!workspaceSlug) return;
      await SprintRepository.moveTicketInSprint(workspaceSlug, ticketId, { anchorTicketId, anchorAfter });
      await queryClient.invalidateQueries({ queryKey: sprintKeys.allTicketIds(workspaceSlug) });
    },
    [workspaceSlug, queryClient],
  );

  return {
    sprints: data ?? NO_SPRINTS,
    loading,
    error: failed ? 'スプリントを読み込めませんでした。' : null,
    busyId,
    reload,
    create,
    update,
    changeState,
    remove,
    addTicket,
    removeTicket,
    moveTicket,
  };
}
