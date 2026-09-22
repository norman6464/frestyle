import { useState } from 'react';
import type { KbPageVersion } from '@/entities/kb';
import Button from '@/shared/ui/Button';
import KbVersionListItem from './KbVersionListItem';
import KbVersionSaveForm from './KbVersionSaveForm';

export interface KbVersionsPanelProps {
  versions: KbPageVersion[];
  loading: boolean;
  error: string | null;
  /** 「版を残す」フォームは編集権限が要る。読むことは誰でもできる（canView）。 */
  canEdit: boolean;
  /** プレビュー中の版（無ければ null）。一覧の該当行をハイライトする。 */
  selectedSeq: number | null;
  onCreateVersion: (note?: string) => Promise<void>;
  onSelectVersion: (seq: number) => void;
}

/**
 * KbVersionsPanel は履歴パネルの中身（版を残すフォーム + 一覧、新しい順）。
 *
 * KbCommentsPanel と同じ流儀 — 状態は受け取るだけで、自分では取りに行かない
 * （取得は useKbPageVersions が持つ）。読み込み中・空・失敗の見た目もそちらに揃える。
 *
 * **読むことは canEdit に関わらず誰でもできる。**「版を残す」フォームだけが
 * canEdit の人に限られる（KbCommentsPanel の canComment と同じ形）。
 */
export default function KbVersionsPanel({
  versions,
  loading,
  error,
  canEdit,
  selectedSeq,
  onCreateVersion,
  onSelectVersion,
}: KbVersionsPanelProps) {
  // 「版を残す」フォームの開閉。KbCommentsPanel の pendingAnchor と違い、この画面専用の
  // 純粋な UI トグルなので、useKbPageVersions ではなくここでローカルに持つ。
  const [showSaveForm, setShowSaveForm] = useState(false);

  return (
    <div className="flex flex-col gap-4 p-3">
      {/* 一覧の取得中はフォームを出さない（KbCommentsPanel と同じ最低限の防御 —
          まだ読めていない一覧の上に新規作成を重ねさせない）。 */}
      {canEdit && !loading && (
        <div className="rounded-lg border border-surface-3 bg-surface-1 p-3">
          {showSaveForm ? (
            <>
              <h3 className="mb-1.5 text-[0.6875rem] font-bold tracking-wide text-[var(--color-text-muted)]">
                版を残す
              </h3>
              <KbVersionSaveForm
                onSubmit={async (note) => {
                  await onCreateVersion(note || undefined);
                  setShowSaveForm(false);
                }}
                onCancel={() => setShowSaveForm(false)}
              />
            </>
          ) : (
            <Button type="button" size="sm" variant="secondary" fullWidth onClick={() => setShowSaveForm(true)}>
              版を残す
            </Button>
          )}
        </div>
      )}

      {loading && (
        // 件数は分からないので 2 行に固定する（KbCommentsPanel と同じ理由）。
        <div className="flex flex-col gap-1.5" role="status" aria-label="履歴を読み込み中">
          <div className="h-12 animate-skeleton rounded bg-surface-2" />
          <div className="h-12 animate-skeleton rounded bg-surface-2" />
        </div>
      )}

      {!loading && error && (
        <p role="alert" className="text-sm leading-relaxed text-danger-ink">
          {error}
        </p>
      )}

      {!loading && !error && versions.length === 0 && (
        <p className="text-xs leading-relaxed text-[var(--color-text-muted)]">
          まだ版がありません。
        </p>
      )}

      {!loading && !error && versions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {versions.map((version) => (
            <KbVersionListItem
              key={version.seq}
              version={version}
              selected={version.seq === selectedSeq}
              onSelect={onSelectVersion}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
