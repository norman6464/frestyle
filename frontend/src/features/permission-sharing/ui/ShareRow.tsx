import type { ShareRole, ShareRow as ShareRowData } from '../model/types';
import { ROLES, displayName } from '../model/labels';
import { FsIcon } from '@/shared/ui';
import { SHARE_SELECT_CLASS } from './selectClass';

export interface ShareRowProps {
  row: ShareRowData;
  /** 書き込み中は操作を止める（二重に送らない）。 */
  disabled: boolean;
  onChangeRole: (role: ShareRole) => void;
  onRemove: () => void;
}

/**
 * ShareRow は共有パネルの 1 行（相手・役割・外す）。
 *
 * 名前が引けなかった相手は ID で出す。行ごと消すと、取り消せない権限が画面から
 * 見えないまま残る（誰が見られるのかを人が説明できなくなる）。
 */
export default function ShareRow({ row, disabled, onChangeRole, onRemove }: ShareRowProps) {
  const name = displayName(row.name, row.principalId);
  return (
    <li className="flex flex-wrap items-center gap-2 rounded px-1 py-2 hover:bg-surface-2">
      <span
        aria-hidden="true"
        className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-surface-3 bg-surface-2 text-xs font-bold text-[var(--color-text-tertiary)]"
      >
        {initials(row)}
      </span>
      <span className="min-w-0 flex-1 basis-24">
        {/* 名前が引けなかった相手は ID が出る。切り詰められるので全体を title で補う。 */}
        <span
          title={name}
          className="block text-sm font-medium text-[var(--color-text-primary)] [overflow-wrap:anywhere]"
        >
          {name}
        </span>
        <span className="block text-xs text-[var(--color-text-muted)]">
          {KIND_LABEL[row.kind]}
        </span>
      </span>
      <select
        aria-label={`${name} の役割`}
        value={row.role}
        onChange={(e) => onChangeRole(e.target.value as ShareRole)}
        disabled={disabled}
        className={`shrink-0 ${SHARE_SELECT_CLASS}`}
      >
        {ROLES.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label={`${name} を外す`}
        className="shrink-0 rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-danger-soft hover:text-danger-ink disabled:opacity-45"
      >
        <FsIcon name="x" className="h-4 w-4" />
      </button>
    </li>
  );
}

const KIND_LABEL: Record<ShareRowData['kind'], string> = {
  user: 'メンバー',
  group: 'グループ',
  space_all: 'スペースの全員',
  // 相手の一覧に居ない ID。引いた直後に主体が消えるとこうなる。行は残す
  // （消すと、取り消せない権限が画面から見えないまま残る）。
  unknown: '不明な相手',
};

function initials(row: ShareRowData): string {
  if (row.kind === 'space_all') return '全';
  if (row.kind === 'group') return 'G';
  const name = row.name.trim();
  return name === '' ? '?' : name.slice(0, 1);
}
