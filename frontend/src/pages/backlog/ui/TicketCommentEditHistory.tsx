import { formatDateTime } from '@/shared/lib/formatters';
import Loading from '@/shared/ui/Loading';
import type { CommentEditsState } from '../model/useCommentEdits';
import TicketCommentBody from './TicketCommentBody';

export interface TicketCommentEditHistoryProps {
  state: CommentEditsState;
  resolveMentionName: (userId: string) => string | null;
}

/** 「（編集済み）」を開いたときに展開する、編集前の本文の列（新しい順・backend のまま）。 */
export default function TicketCommentEditHistory({ state, resolveMentionName }: TicketCommentEditHistoryProps) {
  if (state.loading) return <Loading size="small" />;

  if (state.error) {
    return (
      <p role="alert" className="text-sm text-danger-ink">
        {state.error}
      </p>
    );
  }

  if (state.edits.length === 0) {
    return <p className="text-xs text-[var(--color-text-muted)]">編集履歴はありません</p>;
  }

  return (
    <ul className="flex flex-col gap-1.5">
      {state.edits.map((edit) => (
        <li key={edit.id} className="border-l-2 border-surface-3 pl-2 text-xs">
          <div className="text-[var(--color-text-muted)]">
            {edit.editor.name || '不明なユーザー'} が {formatDateTime(edit.editedAt)} に編集
          </div>
          <TicketCommentBody body={edit.previousBody} resolveMentionName={resolveMentionName} />
        </li>
      ))}
    </ul>
  );
}
