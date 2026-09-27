import { useCallback, useEffect, useRef, useState } from 'react';
import { SprintRepository, type Sprint, type SprintInput, type SprintState } from '@/entities/sprint';

interface SprintsState {
  /** この一覧がどの宛先（`workspaceSlug projectId`）のものか。今の宛先と違えば出さない。 */
  key: string | null;
  sprints: Sprint[];
  loading: boolean;
  error: string | null;
}

const NO_SPRINTS: Sprint[] = [];

function targetKeyOf(workspaceSlug: string | undefined, projectId: string | undefined): string | null {
  return workspaceSlug && projectId ? `${workspaceSlug} ${projectId}` : null;
}

/**
 * useSprints はプロジェクトのスプリント一覧と、その操作をまとめる。
 *
 * 操作のあとは必ず一覧を取り直す。件数（ticketCount）や状態は backend が決めるので、
 * 手元で組み立て直すと「画面では開始したのに実際は弾かれていた」がありうる
 * （進行中は 1 つまで・終わったスプリントには足せない、といった規則は backend が持つ）。
 *
 * 一覧は取得した宛先と組にして持ち、今の宛先のものだけを返す。プロジェクトを切り替えた
 * 直後の描画や、切り替え先の取得に失敗したときに、前のプロジェクトのスプリントを出さない。
 */
export function useSprints(workspaceSlug: string | undefined, projectId: string | undefined) {
  const targetKey = targetKeyOf(workspaceSlug, projectId);
  const [state, setState] = useState<SprintsState>({ key: null, sprints: NO_SPRINTS, loading: false, error: null });
  const [busyId, setBusyId] = useState<string | null>(null);
  // 今の宛先と、要求の連番。最後に投げた取得の応答だけを採用する。
  // 連番だけでは足りない —— 前のプロジェクトで始めた操作（作成・開始など）は、終わると
  // そのときの reload を呼ぶ。切り替えたあとにそれが連番を進めると、今のプロジェクトの
  // 取得が捨てられ、前のプロジェクトの一覧が入る。宛先が今と違う reload は何もしない。
  const currentKey = useRef(targetKey);
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const key = targetKeyOf(workspaceSlug, projectId);
    if (key !== currentKey.current) return;
    const request = ++seq.current;
    if (!workspaceSlug || !projectId) {
      setState({ key: null, sprints: NO_SPRINTS, loading: false, error: null });
      return;
    }
    setState((prev) => ({ key, sprints: prev.key === key ? prev.sprints : NO_SPRINTS, loading: true, error: null }));
    try {
      const list = await SprintRepository.fetchSprints(workspaceSlug, projectId);
      if (seq.current === request) setState({ key, sprints: list, loading: false, error: null });
    } catch {
      // 同じプロジェクトの取り直しの失敗なら、手元の一覧は残して失敗だけを知らせる。
      if (seq.current === request) {
        setState((prev) => ({ ...prev, loading: false, error: 'スプリントを読み込めませんでした。' }));
      }
    }
  }, [workspaceSlug, projectId]);

  useEffect(() => {
    currentKey.current = targetKey;
    void reload();
  }, [targetKey, reload]);

  // 切り替えた直後（取得を始める effect より前）の描画では、まだ前の宛先の state が残っている。
  const shown =
    state.key === targetKey ? state : { sprints: NO_SPRINTS, loading: targetKey !== null, error: null };

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
    sprints: shown.sprints,
    loading: shown.loading,
    error: shown.error,
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
