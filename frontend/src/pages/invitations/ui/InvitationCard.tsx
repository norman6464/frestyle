import { useId } from 'react';
import { kbRoleLabel, type KbInvitation } from '@/entities/kb';
import { Button, FsIcon } from '@/shared/ui';
import { formatInvitationDateTime, formatInvitationDeadline } from '../lib/invitationDate';

export interface InvitationCardProps {
  invitation: KbInvitation;
  /** いま参加を送っている。 */
  accepting: boolean;
  /** いまほかの招待への操作が飛んでいる（この招待は押せない）。 */
  locked: boolean;
  /** 参加・辞退に失敗した理由。カードの位置に出す（トーストにしない）。 */
  failure?: { title: string; description: string } | null;
  onAccept: () => void;
  onDecline: () => void;
  /** 失敗の後の「一覧を更新」。 */
  onRefresh: () => void;
}

/**
 * 届いている招待 1 件（設計ボード ST15）。左に参加する場所（ワークスペース名・URL 名・招待日時・
 * 招いた人・期限）、右に「参加後の役割」と操作（参加する → 辞退する の順）。
 *
 * 招いた人と期限は見本には無いが、backend が意図して返している情報で、知らない相手からの
 * 招待を見分ける手がかりになるので残す（小さく添える）。
 *
 * 参加・辞退に失敗したら、そのカードの中に理由と「一覧を更新」を出す（ST18「この招待は現在
 * 利用できません」）。どの招待の失敗かが位置で分かる。
 */
export default function InvitationCard({
  invitation,
  accepting,
  locked,
  failure = null,
  onAccept,
  onDecline,
  onRefresh,
}: InvitationCardProps) {
  const headingId = useId();
  const role = kbRoleLabel(invitation.role);
  const deadline = formatInvitationDeadline(invitation.expiresAt);

  return (
    <article
      aria-labelledby={headingId}
      aria-busy={accepting || undefined}
      className="overflow-hidden rounded-2xl border border-surface-3 bg-surface-1 sm:flex"
    >
      {/* 場所の印。狭い画面では上の帯、広い画面では左の帯。 */}
      <div aria-hidden="true" className="flex h-2 items-center justify-center bg-brand-50 sm:h-auto sm:w-20 sm:shrink-0">
        <FsIcon name="login" className="hidden h-6 w-6 text-[var(--color-text-secondary)] sm:block" />
      </div>

      <div className="min-w-0 flex-1 p-5 sm:p-6">
        <p aria-hidden="true" className="font-mono text-xs tracking-[0.14em] text-[var(--color-text-muted)]">
          WORKSPACE INVITATION
        </p>
        <h3 id={headingId} className="mt-2 text-2xl font-bold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">
          {invitation.workspaceName}
        </h3>
        <p className="mt-1 font-mono text-sm text-[var(--color-text-muted)] [overflow-wrap:anywhere]">
          {invitation.workspaceSlug}
        </p>
        <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-[var(--color-text-muted)]">招待日時</dt>
          <dd className="text-[var(--color-text-secondary)]">{formatInvitationDateTime(invitation.lastSentAt || invitation.createdAt)}</dd>
          {invitation.inviterName && (
            <>
              <dt className="text-[var(--color-text-muted)]">招いた人</dt>
              <dd className="text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{invitation.inviterName}</dd>
            </>
          )}
          {deadline && (
            <>
              <dt className="text-[var(--color-text-muted)]">期限</dt>
              <dd className="text-[var(--color-text-secondary)]">{deadline}まで</dd>
            </>
          )}
        </dl>
        {failure && (
          <div role="alert" className="mt-4 rounded-lg border border-danger-soft bg-danger-soft p-3 text-sm">
            <p className="flex items-center gap-1.5 font-semibold text-danger-ink">
              <FsIcon name="alert-circle" className="h-4 w-4 shrink-0" />
              {failure.title}
            </p>
            <p className="mt-1 text-[var(--color-text-secondary)]">{failure.description}</p>
            <Button variant="secondary" size="sm" onClick={onRefresh} className="mt-2">
              一覧を更新
            </Button>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4 border-t border-surface-3 p-5 sm:w-72 sm:shrink-0 sm:border-l sm:border-t-0 sm:p-6">
        <div className="flex items-center justify-between gap-3 sm:block">
          <p className="text-sm text-[var(--color-text-muted)]">参加後の役割</p>
          <p className="text-lg font-bold text-[var(--color-text-primary)] sm:mt-1 sm:text-2xl">{role}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="primary" onClick={onAccept} disabled={locked || accepting} className="min-h-11 flex-1">
            {accepting ? '参加処理中…' : '参加する'}
          </Button>
          <Button variant="secondary" onClick={onDecline} disabled={locked || accepting} className="min-h-11 flex-1">
            辞退する
          </Button>
        </div>
      </div>
    </article>
  );
}
