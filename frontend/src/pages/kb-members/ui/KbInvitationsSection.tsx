import type { KbInvitation } from '@/entities/kb';
import { Button, Disclosure, FsIcon, Loading } from '@/shared/ui';
import { INVITATION_STATUS_CLASS, INVITATION_STATUS_LABEL, formatInvitationDate } from '../lib/invitationMessages';

export interface KbInvitationsSectionProps {
  invitations: KbInvitation[];
  loading: boolean;
  /** 取得に失敗した（admin でない場合は画面ごと出し分けるので、ここへは来ない）。 */
  failed: boolean;
  busyId: string | null;
  onRetry: () => void;
  onResend: (invitation: KbInvitation) => void;
  onRevoke: (invitation: KbInvitation) => void;
}

const HEAD_CLASS = 'px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-[var(--color-text-muted)]';

function StatusBadge({ invitation }: { invitation: KbInvitation }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${INVITATION_STATUS_CLASS[invitation.status]}`}>
      {INVITATION_STATUS_LABEL[invitation.status]}
    </span>
  );
}

/**
 * KbInvitationsSection はメンバー管理画面の「招待中」。未決（承諾待ち・期限切れ）を表に出し、
 * 結果が出たもの（承諾・辞退・取り消し）は畳んだ「過去の招待」に置く。
 *
 * 招待リンクはここには出ない — トークンは発行・再送の応答でしか返らないため。
 * 「再送」を押すと新しいリンクがダイアログに出る（前のリンクは使えなくなる）。
 */
export default function KbInvitationsSection({
  invitations,
  loading,
  failed,
  busyId,
  onRetry,
  onResend,
  onRevoke,
}: KbInvitationsSectionProps) {
  const open = invitations.filter((inv) => inv.status === 'pending' || inv.status === 'expired');
  const history = invitations.filter((inv) => inv.status !== 'pending' && inv.status !== 'expired');

  return (
    <section aria-labelledby="kb-invitations-heading" className="mt-10">
      <div className="mb-3">
        <h2 id="kb-invitations-heading" className="text-base font-semibold text-[var(--color-text-primary)]">
          招待中 <span className="font-normal text-[var(--color-text-muted)]">{open.length}件</span>
        </h2>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          相手が承諾するまで、所属や権限は発生しません。招待リンクは発行と再送のときにだけ表示されます。
        </p>
      </div>

      {loading ? (
        <Loading className="min-h-24" message="招待を読み込んでいます" />
      ) : failed ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-3 bg-surface-1 p-4">
          <p className="text-sm text-[var(--color-text-primary)]">招待の一覧を読み込めませんでした。</p>
          <Button variant="secondary" onClick={onRetry} className="min-h-11">再読み込み</Button>
        </div>
      ) : open.length === 0 ? (
        <p className="rounded-xl border border-dashed border-surface-3 p-6 text-center text-sm text-[var(--color-text-muted)]">
          承諾待ちの招待はありません。
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
          <table role="table" aria-label="承諾待ちの招待" className="w-full border-collapse">
            <thead role="rowgroup" className="sr-only md:not-sr-only">
              <tr role="row" className="border-b border-surface-3">
                <th className={HEAD_CLASS}>宛先</th>
                <th className={HEAD_CLASS}>役割</th>
                <th className={HEAD_CLASS}>状態</th>
                <th className={HEAD_CLASS}>招いた人</th>
                <th className={HEAD_CLASS}>期限</th>
                <th className={`${HEAD_CLASS} text-right`}>操作</th>
              </tr>
            </thead>
            <tbody role="rowgroup">
              {open.map((inv) => {
                const busy = busyId === inv.id;
                return (
                  <tr key={inv.id} role="row" aria-busy={busy} className="grid grid-cols-2 border-b border-surface-3 p-2 last:border-b-0 md:table-row md:p-0">
                    <td role="cell" className="col-span-2 min-w-0 px-3 py-3 md:px-4">
                      <div className="text-sm font-semibold text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{inv.email}</div>
                      <div className="text-xs text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{inv.inviteeName || '（名前なし）'}</div>
                    </td>
                    <td role="cell" className="px-3 py-2 md:px-4 md:py-3">
                      <span aria-hidden="true" className="mb-1 block text-xs text-[var(--color-text-muted)] md:hidden">役割</span>
                      <span className="text-sm text-[var(--color-text-secondary)]">{inv.role}</span>
                    </td>
                    <td role="cell" className="px-3 py-2 md:px-4 md:py-3">
                      <span aria-hidden="true" className="mb-1 block text-xs text-[var(--color-text-muted)] md:hidden">状態</span>
                      <StatusBadge invitation={inv} />
                    </td>
                    <td role="cell" className="px-3 py-2 md:px-4 md:py-3">
                      <span aria-hidden="true" className="mb-1 block text-xs text-[var(--color-text-muted)] md:hidden">招いた人</span>
                      <span className="text-sm text-[var(--color-text-secondary)]">{inv.inviterName || '（不明）'}</span>
                    </td>
                    <td role="cell" className="px-3 py-2 md:px-4 md:py-3">
                      <span aria-hidden="true" className="mb-1 block text-xs text-[var(--color-text-muted)] md:hidden">期限</span>
                      <span className={`text-sm ${inv.status === 'expired' ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-text-secondary)]'}`}>
                        {formatInvitationDate(inv.expiresAt)}
                      </span>
                    </td>
                    <td role="cell" className="col-span-2 px-3 py-2 md:px-4 md:py-3">
                      <div className="flex justify-end gap-1">
                        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onResend(inv)} className="min-h-11 md:min-h-9">
                          再送
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRevoke(inv)} className="min-h-11 text-danger-ink md:min-h-9">
                          取り消す
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!loading && !failed && history.length > 0 && (
        <Disclosure label={`過去の招待（${history.length}件）`} className="mt-3">
          <ul className="divide-y divide-surface-3 overflow-hidden rounded-xl border border-surface-3 bg-surface-1">
            {history.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
                <span className="min-w-0 flex-1 font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]">{inv.email}</span>
                <span className="text-[var(--color-text-secondary)]">{inv.role}</span>
                <StatusBadge invitation={inv} />
                <span className="text-xs text-[var(--color-text-muted)]">
                  <FsIcon name="clock" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                  {formatInvitationDate(inv.acceptedAt ?? inv.declinedAt ?? inv.revokedAt ?? inv.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </section>
  );
}
