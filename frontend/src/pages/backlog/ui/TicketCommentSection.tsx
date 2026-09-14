import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import Loading from '@/shared/ui/Loading';
import { useToast } from '@/shared/lib/hooks/useToast';
import { getApiError } from '@/shared/lib/classifyApiError';
import type { TicketCommentBlock } from '@/entities/ticket';
import { useTicketComments } from '../model/useTicketComments';
import { useCurrentUserId } from '../model/useCurrentUserId';
import { useWorkspaceMembers } from '../model/useWorkspaceMembers';
import { buildCommentTree } from '../lib/buildCommentTree';
import TicketCommentComposer from './TicketCommentComposer';
import TicketCommentItem from './TicketCommentItem';
import TicketCommentThread from './TicketCommentThread';

export interface TicketCommentSectionProps {
  workspaceSlug: string;
  ticketId: string;
  /** 副パネルでの表示。最新 3 件だけ・返信/編集履歴/反応の追加は出さない。 */
  compact?: boolean;
}

const VISIBLE_THREADS = 10;
const COMPACT_COUNT = 3;

function withPermissionToast<T>(
  action: () => Promise<T>,
  showToast: (type: 'error', message: string) => void,
  failureMessage: string,
): Promise<T> {
  return action().catch((cause) => {
    showToast('error', getApiError(cause).status === 403 ? 'この操作を行う権限がありません。' : failureMessage);
    throw cause;
  });
}

/**
 * TicketCommentSection は発言の一式（取得・投稿・返信・編集・削除・反応）をまとめる。
 *
 * 全画面の主列とバックログの副パネルの両方から使う（互いに同時マウントされない別ルート
 * なので、それぞれが自分の useTicketComments を持ってよい）。並びが違う:
 * 全画面はコンポーザが先頭、副パネルは最新 3 件の後にコンポーザを置く（見本のとおり）。
 */
export default function TicketCommentSection({ workspaceSlug, ticketId, compact = false }: TicketCommentSectionProps) {
  const { comments, loading, error, refresh, createComment, editComment, deleteComment, addReaction, removeReaction } =
    useTicketComments(workspaceSlug, ticketId);
  const currentUserId = useCurrentUserId();
  const { members } = useWorkspaceMembers(workspaceSlug);
  const { showToast } = useToast();
  const [showAllThreads, setShowAllThreads] = useState(false);

  // ワークスペースの人一覧を主にし、そこに居ない相手（脱退済み等）だけ発言の author/editor
  // から補う（PR3 時点の暫定名簿。人一覧 API が入った今もフォールバックとして残す）。
  const mentionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of comments) {
      if (c.author.name) map.set(String(c.author.userId), c.author.name);
    }
    for (const m of members) {
      if (m.name) map.set(String(m.userId), m.name);
    }
    return map;
  }, [comments, members]);
  const resolveMentionName = (userId: string) => mentionNames.get(userId) ?? null;

  const handleCreate = (body: TicketCommentBlock[], parentCommentId?: string) =>
    withPermissionToast(() => createComment(body, parentCommentId), showToast, 'コメントを投稿できませんでした。');
  /** TicketCommentThread の onReply（引数順が逆・戻り値を捨てる）に合わせる薄い橋渡し。 */
  const handleReply = (parentCommentId: string, body: TicketCommentBlock[]) =>
    handleCreate(body, parentCommentId).then(() => undefined);
  const handleEdit = (commentId: string, body: TicketCommentBlock[]) =>
    withPermissionToast(() => editComment(commentId, body), showToast, 'コメントを更新できませんでした。');
  const handleDelete = (commentId: string) =>
    withPermissionToast(() => deleteComment(commentId), showToast, 'コメントを削除できませんでした。');
  const handleReact = (commentId: string, emoji: string) => {
    if (currentUserId === null) return;
    const comment = comments.find((c) => c.id === commentId);
    const mine = comment?.reactions.some((r) => r.userId === currentUserId && r.emoji === emoji) ?? false;
    const action = mine
      ? () => removeReaction(commentId, emoji, currentUserId)
      : () => addReaction(commentId, emoji, currentUserId);
    void withPermissionToast(action, showToast, mine ? '反応を外せませんでした。' : '反応を付けられませんでした。');
  };

  const composer = (
    <TicketCommentComposer
      onSubmit={(body) => handleCreate(body).then(() => undefined)}
      members={members}
      placeholder="コメントを追加する..."
      submitLabel="保存"
      collapsible
    />
  );

  if (compact) {
    const latest = comments.slice(-COMPACT_COUNT);
    return (
      <div className="flex flex-col gap-2">
        {loading && <Loading size="small" />}
        {!loading && error && (
          <p role="alert" className="text-xs text-red-700">
            {error}
          </p>
        )}
        {!loading && !error && latest.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)]">まだコメントはありません</p>
        )}
        {!loading &&
          !error &&
          latest.map((comment) => (
            <TicketCommentItem
              key={comment.id}
              comment={comment}
              replyTo={null}
              currentUserId={currentUserId}
              compact
              workspaceSlug={workspaceSlug}
              ticketId={ticketId}
              members={members}
              replyOpen={false}
              onToggleReply={() => {}}
              onReply={async () => {}}
              onEdit={(body) => handleEdit(comment.id, body)}
              onDelete={() => handleDelete(comment.id)}
              onReact={() => {}}
              resolveMentionName={resolveMentionName}
              hasReplies={false}
            />
          ))}
        {composer}
        {comments.length > 0 && (
          <Link
            to={`/tickets/${ticketId}`}
            className="text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          >
            すべて見る（{comments.length}）
          </Link>
        )}
      </div>
    );
  }

  const threads = buildCommentTree(comments);
  const visibleThreads = showAllThreads ? threads : threads.slice(-VISIBLE_THREADS);
  const hiddenThreadCount = threads.length - visibleThreads.length;

  return (
    <div className="flex flex-col gap-2">
      {composer}

      {loading && <Loading />}

      {!loading && error && (
        <div className="flex items-center gap-2 text-xs text-red-700">
          <p role="alert" className="flex-1">
            {error}
          </p>
          <button type="button" onClick={refresh} className="font-semibold underline">
            再読み込み
          </button>
        </div>
      )}

      {!loading && !error && threads.length === 0 && (
        <p className="text-sm text-[var(--color-text-muted)]">まだコメントはありません</p>
      )}

      {!loading && !error && hiddenThreadCount > 0 && (
        <button
          type="button"
          className="text-center text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
          onClick={() => setShowAllThreads(true)}
        >
          以前のコメント {hiddenThreadCount} 件を表示
        </button>
      )}

      {!loading &&
        !error &&
        visibleThreads.map((thread) => (
          <TicketCommentThread
            key={thread.root.id}
            thread={thread}
            currentUserId={currentUserId}
            workspaceSlug={workspaceSlug}
            ticketId={ticketId}
            members={members}
            onReply={handleReply}
            onEdit={handleEdit}
            onDelete={handleDelete}
            onReact={handleReact}
            resolveMentionName={resolveMentionName}
          />
        ))}
    </div>
  );
}
