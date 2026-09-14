import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface BacklogUrlPatch {
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
 * useBacklogUrlState は一覧の文脈（どのチケットを選んだか・絞り込み）を URL の問い合わせに載せる。
 *
 * どの面かは**経路が持つ**（/backlog/:projectId・/settings・/archive）。面は戻る・進む・
 * リンク共有の単位なので、問い合わせの飾りではなく経路そのものに出す。
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

  /** プロジェクトを移ったときに前のプロジェクトの文脈を持ち越さない。 */
  const reset = useCallback(
    () =>
      update({
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
    selectedId,
    statusId,
    typeId,
    labelId,
    assigneePrincipalId,
    unassigned,
    assignedToMe,
    overdue,
    q,
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
