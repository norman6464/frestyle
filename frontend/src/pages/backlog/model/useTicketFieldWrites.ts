import type { Label, TicketStatus } from '@/entities/ticket';
import { useWriteOutcomes } from './useWriteOutcomes';

/** 詳細から専用の口で書き換える項目（全置換の PUT とは別の口）。 */
export type TicketWriteKey = 'status' | 'assignee' | 'labels' | 'parent';

export interface TicketFieldActions {
  changeStatus: (statusId: string) => Promise<unknown>;
  assign: (principalId: string) => Promise<unknown>;
  unassign: () => Promise<unknown>;
  toggleLabel: (label: Label, attached: boolean) => Promise<unknown>;
  changeParent: (parentId: string | null) => Promise<unknown>;
}

/** 親の付け替えが断られたときの理由（backend の機械可読コード → 文言）。 */
const PARENT_REASONS: Record<string, string> = {
  ticket_hierarchy_rejected: 'その親には移せません（循環になる、または階層の深さの上限を超えます）。',
};

/**
 * useTicketFieldWrites は詳細パネルと全画面の票が共有する、状態・担当・ラベル・親の書き換えと
 * その結果（PX04）。結果は項目の鍵ごとに `outcomeOf` で返し、呼び出し側が項目のすぐ下に出す。
 *
 * 失敗はトーストにしない（操作した場所に理由を出す）。楽観更新をしていないので、失敗しても
 * 見た目は変更前のまま。
 */
export function useTicketFieldWrites(statuses: TicketStatus[], actions: TicketFieldActions) {
  const { run, outcomeOf } = useWriteOutcomes<TicketWriteKey>();

  const changeStatus = (statusId: string) => {
    const name = statuses.find((s) => s.id === statusId)?.name ?? '選んだ状態';
    return run('status', () => actions.changeStatus(statusId), {
      saving: `「${name}」に変更しています…`,
      saved: `状態を「${name}」にしました`,
      fallback: '状態を変更できませんでした。',
      reasons: { status_not_found: 'この状態は今は選べません。選択肢を更新してください。' },
    });
  };

  const assign = (principalId: string) =>
    run('assignee', () => actions.assign(principalId), {
      saving: '担当を変えています…',
      saved: '担当を保存しました',
      fallback: '担当を設定できませんでした。',
      reasons: { invalid_assignee: 'この人は担当にできません（ワークスペースにいない人です）。' },
    });

  const unassign = () =>
    run('assignee', actions.unassign, {
      saving: '担当を外しています…',
      saved: '担当を外しました',
      fallback: '担当を外せませんでした。',
    });

  const toggleLabel = (label: Label, attached: boolean) =>
    run('labels', () => actions.toggleLabel(label, attached), {
      saving: attached ? `「${label.name}」を外しています…` : `「${label.name}」を付けています…`,
      saved: attached ? `「${label.name}」を外しました` : `「${label.name}」を付けました`,
      fallback: attached ? 'ラベルを外せませんでした。' : 'ラベルを付けられませんでした。',
    });

  const changeParent = (parentId: string | null) =>
    run('parent', () => actions.changeParent(parentId), {
      saving: '親を変えています…',
      saved: parentId ? '親を保存しました' : '親を外しました',
      fallback: '親を変更できませんでした。',
      reasons: PARENT_REASONS,
    });

  return { outcomeOf, changeStatus, assign, unassign, toggleLabel, changeParent };
}
