import { useState } from 'react';
import type { SharePrincipal, ShareRole, ShareRow as ShareRowData } from '../model/types';
import ShareRow from './ShareRow';
import { ROLES, displayName } from '../model/labels';
import { FsIcon } from '@/shared/ui';

export interface SharePanelProps {
  /** いま開いている対象の名前（何を共有しているかの手がかり）。 */
  targetTitle: string;
  /**
   * 一覧に行があるときに見出しの下へ出す一文。
   *
   * **これは飾りではない。** 一覧に出るのはこの段に張った行だけなので、何も書かないと
   * 「これを見られる人の一覧」に読める。実際は上の段から届いている人が居ても、この一覧は
   * 空になり得る。空を「誰も見られない」と取り違えたまま機密を書き込む事故を、文言 1 つで塞ぐ。
   *
   * 段の呼び名は対象で変わり得る（ナレッジはスペースと親ページ）ので、呼び出し側が渡す。
   */
  inheritedNote: string;
  /** 行が 1 つも無いときに出す一文。上の一文より強く、空の意味を明示する。 */
  emptyNote: string;
  /** このページ自身に張った権限。上の段から届いている相手は含まない。 */
  rows: ShareRowData[];
  /** まだ権限を張っていない相手（追加の候補）。 */
  candidates: SharePrincipal[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。 */
  error: string | null;
  /** 書き込みが飛んでいる間 true（二重送信を止める）。 */
  saving: boolean;
  /** 付与。**成功したかを返す**（失敗したときに選択を消さないため）。 */
  onGrant: (principalId: string, role: ShareRole) => Promise<boolean>;
  onRevoke: (principalId: string) => Promise<boolean>;
  onClose: () => void;
}

/**
 * SharePanel はページ単位の権限（既定の 3 段目）を見せて操作する。
 *
 * 設計の記録: https://claude.ai/code/artifact/7a173249-210b-4042-8bc4-d24ccacd303c
 *
 * 状態は受け取るだけで、自分では取りに行かない（取得は useKbShare が持つ）。
 * こうしておくと、読み込み中・空・失敗の見た目を story でそのまま並べられる。
 *
 * 出すかどうかは呼び出し側が canManage を見て決める。権限が無い相手に押せるボタンを
 * 出しても、返るのは 404 だけで「権限が無い」ことすら伝わらない。
 */
export default function SharePanel({
  targetTitle,
  inheritedNote,
  emptyNote,
  rows,
  candidates,
  loading,
  error,
  saving,
  onGrant,
  onRevoke,
  onClose,
}: SharePanelProps) {
  const [pickedPrincipal, setPickedPrincipal] = useState('');
  const [pickedRole, setPickedRole] = useState<ShareRole>('editor');

  const handleAdd = async () => {
    if (!pickedPrincipal) return;
    const added = await onGrant(pickedPrincipal, pickedRole);
    // 成功したときだけ選択を戻す。追加した相手は候補から外れるので、残すと次の追加で
    // もう候補に無い相手を指したままになる。**失敗したときは残す** — 消すと、
    // エラーを読んだ人が同じ相手をもう一度選び直すことになる。
    if (added) setPickedPrincipal('');
  };

  return (
    <section
      aria-label="共有"
      className="w-full max-w-md rounded-lg border border-surface-3 bg-surface-1 shadow-inkwell-8 [&_button]:min-h-11 [&_button]:min-w-11 [&_select]:min-h-11 [&_button]:focus-visible:outline [&_button]:focus-visible:outline-2 [&_button]:focus-visible:outline-brand-600"
    >
      <header className="flex items-center gap-3 border-b border-surface-3 px-4 py-3">
        <h2 className="text-sm font-bold text-[var(--color-text-primary)]">共有</h2>
        <span className="min-w-0 flex-1 truncate text-right text-xs text-[var(--color-text-muted)]">
          {targetTitle}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="共有を閉じる"
          className="-mr-1 inline-flex shrink-0 items-center justify-center rounded p-1 text-[var(--color-text-muted)] transition-colors hover:bg-surface-2"
        >
          <FsIcon name="x" className="h-4 w-4" />
        </button>
      </header>

      <div className="flex flex-col gap-3 px-4 pb-4 pt-3">
        <div>
          <h3 className="text-[0.6875rem] font-bold tracking-wide text-[var(--color-text-muted)]">
            ここで足した権限
          </h3>
          {/*
            注記は行があるときだけ。空のときは下の一文が同じことをより強く言うので、
            両方出すと似た文が 2 つ並んで、どちらも読み飛ばされる。

            **error では消さない。** 書き込みに失敗したときは行が残ったままなので、
            そこで注記だけ消えると、残っている一覧を「見られる人の全部」と読める。
          */}
          {!loading && rows.length > 0 && (
            <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-muted)]">
              {inheritedNote}
            </p>
          )}
        </div>

        {loading && (
          // 件数は分からないので 2 行に固定する（実際の件数に寄せると、
          // 読み込みのたびに高さが跳ねる）。
          <div className="flex flex-col gap-1.5" role="status" aria-label="権限を読み込み中">
            <div className="h-8 animate-skeleton rounded bg-surface-2" />
            <div className="h-8 animate-skeleton rounded bg-surface-2" />
          </div>
        )}

        {!loading && error && (
          <p role="alert" className="py-2 text-sm leading-relaxed text-danger-ink">
            {error}
          </p>
        )}

        {!loading && !error && rows.length === 0 && (
          <p className="mt-0.5 text-xs leading-relaxed text-[var(--color-text-muted)]">{emptyNote}</p>
        )}

        {!loading && rows.length > 0 && (
          <ul className="flex flex-col gap-0.5">
            {rows.map((row) => (
              <ShareRow
                key={row.principalId}
                row={row}
                disabled={saving}
                onChangeRole={(role) => onGrant(row.principalId, role)}
                onRemove={() => onRevoke(row.principalId)}
              />
            ))}
          </ul>
        )}

        <div className="h-px bg-surface-3" />

        <div>
          <h3 className="text-[0.6875rem] font-bold tracking-wide text-[var(--color-text-muted)]">
            相手を足す
          </h3>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              aria-label="足す相手"
              value={pickedPrincipal}
              onChange={(e) => setPickedPrincipal(e.target.value)}
              disabled={saving || candidates.length === 0}
              className="min-w-0 flex-1 basis-full rounded border border-surface-3 bg-surface-1 px-2 py-1.5 text-base text-[var(--color-text-secondary)] sm:basis-32 sm:text-sm"
            >
              <option value="">相手を選ぶ…</option>
              {candidates.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {displayName(candidate.name, candidate.id)}
                </option>
              ))}
            </select>
            <select
              aria-label="与える役割"
              value={pickedRole}
              onChange={(e) => setPickedRole(e.target.value as ShareRole)}
              disabled={saving}
              className="rounded border border-surface-3 bg-surface-1 px-2 py-1.5 text-sm text-[var(--color-text-secondary)]"
            >
              {ROLES.map((role) => (
                <option key={role.value} value={role.value}>
                  {role.label}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAdd}
              disabled={saving || !pickedPrincipal}
              className="shrink-0 rounded bg-brand-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-700 disabled:opacity-45"
            >
              追加
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
