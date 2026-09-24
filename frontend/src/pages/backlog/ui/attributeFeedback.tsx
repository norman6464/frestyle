import type { ReactNode } from 'react';
import type { WriteOutcome } from '../lib/writeOutcome';
import type { TicketEditorField } from '../model/useTicketEditor';
import type { TicketWriteKey } from '../model/useTicketFieldWrites';
import FieldFeedback from './FieldFeedback';
import type { TicketAttributeKey } from './TicketAttributePanel';

/**
 * 属性欄（TicketAttributePanel）の項目ごとの結果を組む。詳細パネルと全画面の票で同じ物を使う。
 *
 * 結果の出どころは 2 つある。全置換の PUT で即時保存する項目（優先度・日付・見積り）は
 * useTicketEditor、専用の口で書き換える項目（担当・ラベル・親）は useTicketFieldWrites。
 * 項目の側からはどちらでも同じ「すぐ下の 1 行」に見える。
 */
export function buildAttributeFeedback(
  editorOutcome: (field: TicketEditorField) => WriteOutcome | null,
  writeOutcome: (key: TicketWriteKey) => WriteOutcome | null,
  onVerify?: () => void,
): Partial<Record<TicketAttributeKey, ReactNode>> {
  const node = (outcome: WriteOutcome | null) =>
    outcome ? <FieldFeedback outcome={outcome} onVerify={onVerify} /> : undefined;
  return {
    assignee: node(writeOutcome('assignee')),
    labels: node(writeOutcome('labels')),
    parent: node(writeOutcome('parent')),
    priority: node(editorOutcome('priority')),
    dueDate: node(editorOutcome('dueDate')),
    startDate: node(editorOutcome('startDate')),
    storyPoints: node(editorOutcome('storyPoints')),
  };
}
