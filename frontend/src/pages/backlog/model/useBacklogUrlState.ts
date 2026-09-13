import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export type BacklogTab = 'tickets' | 'statuses' | 'types';

const TABS: readonly BacklogTab[] = ['tickets', 'statuses', 'types'];

/** 既定の面。URL に出さない（既定を省くと URL が短く保てる）。 */
const DEFAULT_TAB: BacklogTab = 'tickets';

function readTab(value: string | null): BacklogTab {
  return TABS.includes(value as BacklogTab) ? (value as BacklogTab) : DEFAULT_TAB;
}

export interface BacklogUrlPatch {
  tab?: BacklogTab;
  archived?: boolean;
  selectedId?: string | null;
  statusId?: string | null;
  typeId?: string | null;
  labelId?: string | null;
  assigneePrincipalId?: string | null;
  unassigned?: boolean;
  assignedToMe?: boolean;
  overdue?: boolean;
  q?: string;
}

/**
 * useBacklogUrlState は一覧の文脈（どの面か・アーカイブを見ているか・どのチケットを選んだか・
 * 絞り込み）を URL に載せる。
 *
 * 画面の中に閉じた状態にすると、チケットを開いて戻ってきたときに絞り込みも選択も消える。
 * 戻る先が「現役の先頭」に固定されると、朝に何十件も捌く動きが成立しない。絞り込みの保存
 * （サイドバーの「保存した絞り込み」）もこの URL を指すリンクだけで実現する（backend 追加なし）。
 *
 * 履歴は汚さない（`replace`）。面の切り替えや行の選択で戻る操作の回数が増えると、
 * 「戻る」でバックログから出るのに何度も押すことになるため。
 */
export function useBacklogUrlState() {
  const [params, setParams] = useSearchParams();

  const tab = readTab(params.get('tab'));
  const archived = params.get('archived') === '1';
  const selectedId = params.get('ticket');
  const statusId = params.get('statusId');
  const typeId = params.get('typeId');
  const labelId = params.get('labelId');
  const assigneePrincipalId = params.get('assigneePrincipalId');
  const unassigned = params.get('unassigned') === '1';
  const assignedToMe = params.get('assignedToMe') === '1';
  const overdue = params.get('overdue') === '1';
  const q = params.get('q') ?? '';

  const update = useCallback(
    (patch: BacklogUrlPatch) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (patch.tab !== undefined) {
            if (patch.tab === DEFAULT_TAB) next.delete('tab');
            else next.set('tab', patch.tab);
          }
          if (patch.archived !== undefined) {
            if (patch.archived) next.set('archived', '1');
            else next.delete('archived');
          }
          if (patch.selectedId !== undefined) {
            if (patch.selectedId) next.set('ticket', patch.selectedId);
            else next.delete('ticket');
          }
          if (patch.statusId !== undefined) {
            if (patch.statusId) next.set('statusId', patch.statusId);
            else next.delete('statusId');
          }
          if (patch.typeId !== undefined) {
            if (patch.typeId) next.set('typeId', patch.typeId);
            else next.delete('typeId');
          }
          if (patch.labelId !== undefined) {
            if (patch.labelId) next.set('labelId', patch.labelId);
            else next.delete('labelId');
          }
          // 担当の絞り込みは assigneePrincipalId / unassigned / assignedToMe が互いに排他
          // （backend の 400 検証と同じ規則。ticket_handler.go の List 参照）。3 つのどれかを
          // 立てたら、残り 2 つを URL から外す。
          if (patch.assigneePrincipalId !== undefined) {
            if (patch.assigneePrincipalId) {
              next.set('assigneePrincipalId', patch.assigneePrincipalId);
              next.delete('unassigned');
              next.delete('assignedToMe');
            } else {
              next.delete('assigneePrincipalId');
            }
          }
          if (patch.unassigned !== undefined) {
            if (patch.unassigned) {
              next.set('unassigned', '1');
              next.delete('assigneePrincipalId');
              next.delete('assignedToMe');
            } else {
              next.delete('unassigned');
            }
          }
          if (patch.assignedToMe !== undefined) {
            if (patch.assignedToMe) {
              next.set('assignedToMe', '1');
              next.delete('assigneePrincipalId');
              next.delete('unassigned');
            } else {
              next.delete('assignedToMe');
            }
          }
          if (patch.overdue !== undefined) {
            if (patch.overdue) next.set('overdue', '1');
            else next.delete('overdue');
          }
          if (patch.q !== undefined) {
            if (patch.q) next.set('q', patch.q);
            else next.delete('q');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  const setTab = useCallback((value: BacklogTab) => update({ tab: value }), [update]);
  const setArchived = useCallback((value: boolean) => update({ archived: value }), [update]);
  const selectTicket = useCallback((value: string | null) => update({ selectedId: value }), [update]);
  const setStatusId = useCallback((value: string | null) => update({ statusId: value }), [update]);
  const setTypeId = useCallback((value: string | null) => update({ typeId: value }), [update]);
  const setLabelId = useCallback((value: string | null) => update({ labelId: value }), [update]);
  const setAssigneePrincipalId = useCallback(
    (value: string | null) => update({ assigneePrincipalId: value }),
    [update],
  );
  const setUnassigned = useCallback((value: boolean) => update({ unassigned: value }), [update]);
  const setAssignedToMe = useCallback((value: boolean) => update({ assignedToMe: value }), [update]);
  const setOverdue = useCallback((value: boolean) => update({ overdue: value }), [update]);
  const setQuery = useCallback((value: string) => update({ q: value }), [update]);

  /** スペースを移ったときに前のスペースの文脈を持ち越さない。 */
  const reset = useCallback(
    () =>
      update({
        tab: DEFAULT_TAB,
        archived: false,
        selectedId: null,
        statusId: null,
        typeId: null,
        labelId: null,
        assigneePrincipalId: null,
        unassigned: false,
        assignedToMe: false,
        overdue: false,
        q: '',
      }),
    [update],
  );

  return {
    tab,
    archived,
    selectedId,
    statusId,
    typeId,
    labelId,
    assigneePrincipalId,
    unassigned,
    assignedToMe,
    overdue,
    q,
    setTab,
    setArchived,
    selectTicket,
    setStatusId,
    setTypeId,
    setLabelId,
    setAssigneePrincipalId,
    setUnassigned,
    setAssignedToMe,
    setOverdue,
    setQuery,
    reset,
  };
}
