import { KB_ROLE_LABEL, KB_ROLES_STRONGEST_FIRST, type KbAdminWorkspaceMember, type KbGrantRole } from '@/entities/kb';
import Avatar from '@/shared/ui/Avatar';
import { FsIcon } from '@/shared/ui';

export interface KbMemberRowProps {
  member: KbAdminWorkspaceMember;
  /** このメンバーが操作している本人か。自分自身には停止・削除の入口を出さない。 */
  isSelf: boolean;
  /** このメンバー宛ての操作が飛んでいる間 true（役割変更・停止・復帰・削除のどれか）。 */
  busy: boolean;
  onChangeRole: (role: KbGrantRole | null) => void;
  onSuspend: () => void;
  onRestore: () => void;
  onRemove: () => void;
}

/** メンバー管理画面（段 7）の 1 行。役割はその場の select で変える（保存ボタンを挟まない）。 */
export default function KbMemberRow({
  member,
  isSelf,
  busy,
  onChangeRole,
  onSuspend,
  onRestore,
  onRemove,
}: KbMemberRowProps) {
  const suspended = member.accountStatus === 'suspended';

  return (
    // 停止中は行全体を opacity で薄めない — 文字色との掛け合わせでコントラスト比が基準を
    // 割り込む（実測: 4.5:1 必要なところ 2.5 前後まで落ちる）。「状態」列のバッジだけで示す。
    <tr role="row" aria-busy={busy} className="grid grid-cols-2 border-b border-surface-3 p-2 last:border-b-0 md:table-row md:p-0">
      <td role="cell" className="col-span-2 min-w-0 px-3 py-3 md:max-w-xs md:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={member.name || '?'} src={member.avatarUrl || undefined} size="sm" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 text-sm font-semibold text-[var(--color-text-primary)]">
              <span className="min-w-0 [overflow-wrap:anywhere]">{member.name || '（名前未設定）'}</span>
              {isSelf && <span className="text-xs font-normal text-[var(--color-text-muted)]">自分</span>}
            </div>
            {member.statusMessage && (
              <div className="mt-1 text-xs text-[var(--color-text-muted)] [overflow-wrap:anywhere]">{member.statusMessage}</div>
            )}
          </div>
        </div>
      </td>
      <td role="cell" className="min-w-0 px-3 py-2 md:px-4 md:py-3">
        <span aria-hidden="true" className="mb-2 block text-xs text-[var(--color-text-muted)] md:hidden">役割</span>
        {suspended ? (
          <span className="text-sm text-[var(--color-text-muted)]">{member.role ? KB_ROLE_LABEL[member.role] : '役割なし'}</span>
        ) : (
          <select
            aria-label={`${member.name || '相手'} の役割`}
            value={member.role ?? ''}
            disabled={busy}
            onChange={(e) => onChangeRole(e.target.value === '' ? null : (e.target.value as KbGrantRole))}
            className="min-h-11 w-full rounded-md border border-surface-3 bg-surface-1 px-2 py-2 text-base font-medium text-[var(--color-text-secondary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50 md:w-auto md:text-sm"
          >
            <option value="">役割なし</option>
            {KB_ROLES_STRONGEST_FIRST.map((role) => (
              <option key={role} value={role}>
                {KB_ROLE_LABEL[role]}
              </option>
            ))}
          </select>
        )}
      </td>
      <td role="cell" className="px-3 py-2 md:px-4 md:py-3">
        <span aria-hidden="true" className="mb-2 block text-xs text-[var(--color-text-muted)] md:hidden">状態</span>
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
            suspended
              ? 'bg-warning-soft text-warning'
              : 'bg-surface-2 text-[var(--color-text-tertiary)]'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${suspended ? 'bg-warning' : 'bg-success'}`} />
          {suspended ? '停止中' : '有効'}
        </span>
      </td>
      <td role="cell" className="col-span-2 px-3 py-3 md:px-4">
        {isSelf ? (
          <span className="text-xs text-[var(--color-text-muted)]">自分自身は操作できません</span>
        ) : (
          <div className="flex flex-wrap gap-2 md:justify-end">
            {suspended ? (
              <button
                type="button"
                onClick={onRestore}
                disabled={busy}
                aria-label={`${member.name || '相手'} を復帰させる`}
                title="復帰させる"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-surface-3 px-3 text-sm text-[var(--color-text-muted)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
              >
                <FsIcon name="refresh" className="h-4 w-4" />
                復帰
              </button>
            ) : (
              <button
                type="button"
                onClick={onSuspend}
                disabled={busy}
                aria-label={`${member.name || '相手'} を停止する`}
                title="アカウントを停止する"
                className="inline-flex min-h-11 items-center gap-2 rounded-md border border-surface-3 px-3 text-sm text-[var(--color-text-muted)] hover:bg-warning-soft hover:text-warning focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
              >
                <FsIcon name="ban" className="h-4 w-4" />
                停止
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              disabled={busy}
              aria-label={`${member.name || '相手'} をワークスペースから外す`}
              title="ワークスペースから外す"
              className="inline-flex min-h-11 items-center gap-2 rounded-md px-3 text-sm text-[var(--color-text-muted)] hover:bg-danger-soft hover:text-danger-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50"
            >
              <FsIcon name="user-minus" className="h-4 w-4" />
              外す
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}
