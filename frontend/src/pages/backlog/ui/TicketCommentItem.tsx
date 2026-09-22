import { useEffect, useRef, useState } from 'react';
import { EllipsisHorizontalIcon } from '@heroicons/react/24/outline';
import Avatar from '@/shared/ui/Avatar';
import ConfirmModal from '@/shared/ui/ConfirmModal';
import { formatDateTime, formatTime } from '@/shared/lib/formatters';
import type { TicketComment, TicketCommentBlock } from '@/entities/ticket';
import type { KbWorkspaceMember } from '@/entities/kb';
import { useCommentEdits } from '../model/useCommentEdits';
import { summarizeReactions } from '../lib/summarizeReactions';
import TicketCommentBody from './TicketCommentBody';
import TicketCommentComposer from './TicketCommentComposer';
import TicketCommentEditHistory from './TicketCommentEditHistory';
import TicketReactionBar from './TicketReactionBar';

export interface TicketCommentItemProps {
  comment: TicketComment;
  /** 返信先の宛先を「◂ 誰々 へ」として出す（幹への直接の返信は null）。 */
  replyTo: TicketComment | null;
  currentUserId: number | null;
  /** 最新3件だけの副パネル表示。返信・編集履歴・反応の追加は出さない。 */
  compact?: boolean;
  workspaceSlug: string;
  ticketId: string;
  /** 返信・編集欄の '@' 候補。 */
  members: KbWorkspaceMember[];
  replyOpen: boolean;
  onToggleReply: () => void;
  onReply: (body: TicketCommentBlock[]) => Promise<void>;
  onEdit: (body: TicketCommentBlock[]) => Promise<void>;
  onDelete: () => Promise<void>;
  onReact: (emoji: string) => void;
  resolveMentionName: (userId: string) => string | null;
  hasReplies: boolean;
}

/** 発言 1 件。幹・返信のどちらも同じ部品で描く（返信は呼び出し側が字下げする）。 */
export default function TicketCommentItem({
  comment,
  replyTo,
  currentUserId,
  compact = false,
  workspaceSlug,
  ticketId,
  members,
  replyOpen,
  onToggleReply,
  onReply,
  onEdit,
  onDelete,
  onReact,
  resolveMentionName,
  hasReplies,
}: TicketCommentItemProps) {
  const [editing, setEditing] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 「…」メニューの外側クリック・Escape での閉じ（KbRowActions と同じ形。この形は
  // 部品ごとに個別に持つのがこのコードベースの作法で、共有 hook にはしていない）。
  useEffect(() => {
    if (!menuOpen) return;
    const onDocumentMouseDown = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && menuRef.current.contains(event.target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onDocumentMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [menuOpen]);

  const edits = useCommentEdits(workspaceSlug, ticketId, comment.id);
  const isMine = currentUserId !== null && currentUserId === comment.author.userId;
  const authorName = comment.author.name || '不明なユーザー';

  const reactions = summarizeReactions(comment.reactions, currentUserId);
  // 自分判定ができないと押す/外すの向きも決められないので、反応の追加は出さない。
  const canReact = currentUserId !== null && !compact;

  const startEdit = () => {
    setEditing(true);
    setMenuOpen(false);
  };

  const submitEdit = async (body: TicketCommentBlock[]) => {
    await onEdit(body);
    setEditing(false);
  };

  const toggleHistory = () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) void edits.load();
  };

  return (
    <article className="flex gap-2 py-2">
      <Avatar name={authorName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-sm font-medium text-[var(--color-text-primary)]">{authorName}</span>
          <span className="text-xs text-[var(--color-text-muted)]" title={formatDateTime(comment.createdAt)}>
            {formatTime(comment.createdAt)}
          </span>
          {comment.edited && !compact && (
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={historyOpen}
              aria-label={`${authorName} の編集履歴を開く`}
              className="text-xs text-[var(--color-text-muted)] underline decoration-dotted underline-offset-2 hover:text-[var(--color-text-primary)]"
            >
              （編集済み）
            </button>
          )}
        </div>

        {replyTo && (
          <p className="mt-0.5 text-xs text-[var(--color-text-muted)]">◂ {replyTo.author.name || '不明なユーザー'} へ</p>
        )}

        {editing ? (
          <div className="mt-1">
            <TicketCommentComposer
              onSubmit={submitEdit}
              members={members}
              initialBlocks={comment.body}
              resolveMentionName={resolveMentionName}
              placeholder="発言を編集"
              submitLabel="保存"
              onCancel={() => setEditing(false)}
              autoFocus
            />
          </div>
        ) : (
          <TicketCommentBody body={comment.body} resolveMentionName={resolveMentionName} />
        )}

        {!compact && <TicketReactionBar reactions={reactions} canReact={canReact} onToggle={onReact} />}

        {historyOpen && !compact && (
          <div className="mt-1.5">
            <TicketCommentEditHistory state={edits} resolveMentionName={resolveMentionName} />
          </div>
        )}

        <div className="mt-1 flex items-center gap-3">
          {!compact && (
            <button
              type="button"
              onClick={onToggleReply}
              className="text-xs font-semibold text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
            >
              返信
            </button>
          )}
          {!compact && isMine && (
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label={`${authorName} の発言の操作`}
                aria-expanded={menuOpen}
                className="grid h-5 w-5 place-items-center rounded text-[var(--color-text-muted)] hover:bg-surface-2"
              >
                <EllipsisHorizontalIcon className="h-4 w-4" aria-hidden="true" />
              </button>
              {menuOpen && (
                <ul className="absolute left-0 top-full z-10 mt-1 w-28 rounded-md border border-surface-3 bg-surface-1 py-1 shadow-lg">
                  <li>
                    <button
                      type="button"
                      onClick={startEdit}
                      className="block w-full px-3 py-1 text-left text-xs text-[var(--color-text-secondary)] hover:bg-surface-2"
                    >
                      編集
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmingDelete(true);
                      }}
                      className="block w-full px-3 py-1 text-left text-xs text-danger-ink hover:bg-surface-2"
                    >
                      削除
                    </button>
                  </li>
                </ul>
              )}
            </div>
          )}
        </div>

        {replyOpen && !compact && (
          <div className="mt-2">
            <TicketCommentComposer
              onSubmit={onReply}
              members={members}
              placeholder="返信を書く"
              submitLabel="返信"
              onCancel={() => onToggleReply()}
              autoFocus
            />
          </div>
        )}
      </div>

      <ConfirmModal
        isOpen={confirmingDelete}
        title="発言を削除しますか"
        message={
          hasReplies
            ? 'この発言を削除します。取り消せません。返信は残ります。'
            : 'この発言を削除します。取り消せません。'
        }
        confirmText="削除"
        isDanger
        onConfirm={() => {
          setConfirmingDelete(false);
          void onDelete();
        }}
        onCancel={() => setConfirmingDelete(false)}
      />
    </article>
  );
}
