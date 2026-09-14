import { useCallback, useEffect, useState } from 'react';
import { SprintRepository, type Sprint, type SprintInput, type SprintState } from '@/entities/sprint';

/**
 * useSprints はプロジェクトのスプリント一覧と、その操作をまとめる。
 *
 * 操作のあとは必ず一覧を取り直す。件数（ticketCount）や状態は backend が決めるので、
 * 手元で組み立て直すと「画面では開始したのに実際は弾かれていた」がありうる
 * （進行中は 1 つまで・終わったスプリントには足せない、といった規則は backend が持つ）。
 */
export function useSprints(workspaceSlug: string | undefined, projectId: string | undefined) {
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!workspaceSlug || !projectId) {
      setSprints([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      setSprints(await SprintRepository.fetchSprints(workspaceSlug, projectId));
    } catch {
      setError('スプリントを読み込めませんでした。');
    } finally {
      setLoading(false);
    }
  }, [workspaceSlug, projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (input: SprintInput) => {
      if (!workspaceSlug || !projectId) return;
      await SprintRepository.createSprint(workspaceSlug, projectId, input);
      await reload();
    },
    [workspaceSlug, projectId, reload],
  );

  const update = useCallback(
    async (sprintId: string, input: SprintInput) => {
      if (!workspaceSlug) return;
      setBusyId(sprintId);
      try {
        await SprintRepository.updateSprint(workspaceSlug, sprintId, input);
        await reload();
      } finally {
        setBusyId(null);
      }
    },
    [workspaceSlug, reload],
  );

  const changeState = useCallback(
    async (sprintId: string, state: SprintState) => {
      if (!workspaceSlug) return;
      setBusyId(sprintId);
      try {
        await SprintRepository.changeSprintState(workspaceSlug, sprintId, state);
        await reload();
      } finally {
        setBusyId(null);
      }
    },
    [workspaceSlug, reload],
  );

  const remove = useCallback(
    async (sprintId: string) => {
      if (!workspaceSlug) return;
      setBusyId(sprintId);
      try {
        await SprintRepository.deleteSprint(workspaceSlug, sprintId);
        await reload();
      } finally {
        setBusyId(null);
      }
    },
    [workspaceSlug, reload],
  );

  /** チケットをスプリントへ入れる（別のスプリントに居れば移動）。 */
  const addTicket = useCallback(
    async (sprintId: string, ticketId: string) => {
      if (!workspaceSlug) return;
      await SprintRepository.addTicketToSprint(workspaceSlug, sprintId, ticketId);
      await reload();
    },
    [workspaceSlug, reload],
  );

  /** チケットをスプリントから外す（バックログへ戻る）。 */
  const removeTicket = useCallback(
    async (ticketId: string) => {
      if (!workspaceSlug) return;
      await SprintRepository.removeTicketFromSprint(workspaceSlug, ticketId);
      await reload();
    },
    [workspaceSlug, reload],
  );

  /** スプリント内で 1 つ動かす（anchor の手前／直後へ）。 */
  const moveTicket = useCallback(
    async (ticketId: string, anchorTicketId: string, anchorAfter: boolean) => {
      if (!workspaceSlug) return;
      await SprintRepository.moveTicketInSprint(workspaceSlug, ticketId, { anchorTicketId, anchorAfter });
    },
    [workspaceSlug],
  );

  return {
    sprints,
    loading,
    error,
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
