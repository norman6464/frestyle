import { useState } from 'react';
import type { TicketComment, TicketCommentBlock } from '@/entities/ticket';
import type { KbWorkspaceMember } from '@/entities/kb';
import type { CommentThread } from '../lib/buildCommentTree';
import TicketCommentItem from './TicketCommentItem';

export interface TicketCommentThreadProps {
  thread: CommentThread;
  currentUserId: number | null;
  workspaceSlug: string;
  ticketId: string;
  /** 返信欄の '@' 候補。 */
  members: KbWorkspaceMember[];
  onReply: (parentCommentId: string, body: TicketCommentBlock[]) => Promise<void>;
  onEdit: (commentId: string, body: TicketCommentBlock[]) => Promise<void>;
  onDelete: (commentId: string) => Promise<void>;
  onReact: (commentId: string, emoji: string) => void;
  resolveMentionName: (userId: string) => string | null;
}

/** 返信は 3 件を超えたら畳む（「返信をすべて表示（N）」）。 */
const VISIBLE_REPLIES = 3;

/**
 * 幹 1 件と、その返信列（1 段インデント）。
 *
 * 返信の入力欄を開けるのは同時に 1 つ（幹自身への返信、または返信の 1 つへの返信）。
 * 別を押すと前が閉じる。
 */
export default function TicketCommentThread({
  thread,
  currentUserId,
  workspaceSlug,
  ticketId,
  members,
  onReply,
  onEdit,
  onDelete,
  onReact,
  resolveMentionName,
}: TicketCommentThreadProps) {
  const [replyOpenFor, setReplyOpenFor] = useState<string | null>(null);
  const [showAllReplies, setShowAllReplies] = useState(false);

  const repliesById = new Map<string, TicketComment>();
  repliesById.set(thread.root.id, thread.root);
  for (const r of thread.replies) repliesById.set(r.comment.id, r.comment);

  const visibleReplies = showAllReplies ? thread.replies : thread.replies.slice(0, VISIBLE_REPLIES);
  const hiddenCount = thread.replies.length - visibleReplies.length;

  const toggleReply = (id: string) => setReplyOpenFor((cur) => (cur === id ? null : id));

  return (
    <div className="border-t border-surface-3 pt-2">
      <TicketCommentItem
        comment={thread.root}
        replyTo={null}
        currentUserId={currentUserId}
        workspaceSlug={workspaceSlug}
        ticketId={ticketId}
        members={members}
        replyOpen={replyOpenFor === thread.root.id}
        onToggleReply={() => toggleReply(thread.root.id)}
        onReply={(body) => onReply(thread.root.id, body).then(() => setReplyOpenFor(null))}
        onEdit={(body) => onEdit(thread.root.id, body)}
        onDelete={() => onDelete(thread.root.id)}
        onReact={(emoji) => onReact(thread.root.id, emoji)}
        resolveMentionName={resolveMentionName}
        hasReplies={thread.replies.length > 0}
      />

      {thread.replies.length > 0 && (
        <div className="ml-9 border-l border-surface-3 pl-3">
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllReplies(true)}
              className="py-1 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              返信をすべて表示（{thread.replies.length}）
            </button>
          )}
          {visibleReplies.map(({ comment, replyToId }) => (
            <TicketCommentItem
              key={comment.id}
              comment={comment}
              replyTo={replyToId ? repliesById.get(replyToId) ?? null : null}
              currentUserId={currentUserId}
              workspaceSlug={workspaceSlug}
              ticketId={ticketId}
              members={members}
              replyOpen={replyOpenFor === comment.id}
              onToggleReply={() => toggleReply(comment.id)}
              onReply={(body) => onReply(comment.id, body).then(() => setReplyOpenFor(null))}
              onEdit={(body) => onEdit(comment.id, body)}
              onDelete={() => onDelete(comment.id)}
              onReact={(emoji) => onReact(comment.id, emoji)}
              resolveMentionName={resolveMentionName}
              hasReplies={false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
