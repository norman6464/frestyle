import type { ReactNode } from 'react';
import type { KbEditorRef, KbLabel } from '@/entities/kb';
import { formatHourMinute, formatMonthDay } from '@/shared/lib/formatters';
import { FsIcon, Avatar, LabelChip } from '@/shared/ui';
import { SAVE_STATUS_LABEL, type SaveStatus } from '@/shared/lib/saveStatus';

export type KbPageVisibility = 'public' | 'space' | 'private';

/** 見ている人がこのページに何をできるか。編集できない人にだけ印を出す。 */
export type KbPageAccess = 'edit' | 'comment' | 'view';

export interface KbPageMetaProps {
  /** 最終編集の人と日時。まだ保存の記録が無いページでは null。 */
  lastEditedBy: KbEditorRef | null;
  lastEditedAt: string | null;
  /** 公開範囲（段 13）。 */
  visibility: KbPageVisibility;
  /** ページに付いたラベル（段 8）。 */
  labels: KbLabel[];
  /** このページを見たことのある人数（段 2）。渡さなければ出さない。 */
  viewCount?: number;
  /** 本文の文字数から見積もった読了分数（クライアント側で計算）。無ければ出さない。 */
  readMinutes?: number | null;
  /**
   * 本文の保存状態。編集できる人にだけ渡す。読み上げ用の領域は最初から置いておき、
   * 変わったときにだけ文字を入れる（後から領域が現れても、読み上げは拾わない）。
   */
  saveStatus?: SaveStatus;
  /** 見ている人の権限。'edit' 以外は「閲覧のみ」「コメント可」の印を出す。 */
  access?: KbPageAccess;
  /** 最終編集の行の右端に置く操作（KbPage が組む「ページの操作」）。 */
  actions?: ReactNode;
}

const VISIBILITY_LABEL: Record<KbPageVisibility, string> = {
  public: '全体公開',
  space: 'スペース',
  private: '非公開',
};

/**
 * 公開範囲バッジ。何の値かが分かるよう「公開範囲:」を添える（「スペース」だけでは
 * 場所の名前と読める）。'space'（既定）は目立たせず、'private' だけ制限が強いことが分かる見た目にする。
 */
function KbVisibilityBadge({ visibility }: { visibility: KbPageVisibility }) {
  const tone =
    visibility === 'public'
      ? 'bg-brand-100 text-brand-800'
      : visibility === 'private'
        ? 'bg-taupe-600 text-white'
        : 'bg-taupe-100 text-taupe-600';
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold leading-relaxed ${tone}`}>
      {visibility === 'private' && <FsIcon name="lock" className="h-2.5 w-2.5" />}
      <span className="font-normal opacity-80">公開範囲:</span>
      {VISIBILITY_LABEL[visibility]}
    </span>
  );
}

/**
 * KbPageMeta は題名の下の 2 行（報道系サイトの記事面の、題名 → 副題 → 配信元と日時・操作 の組み方）。
 *
 * 1 行目は「このページは何か」: 公開範囲 → ラベル → 権限の印 → 閲覧数・読了時間。
 * 2 行目は「誰がいつ」と操作: 左に 最終編集（人と日時）と保存状態、右端に操作（KbPage が渡す）。
 * 最終編集が無い（まだ保存の記録が無いページ）ときはその部分だけを省く — 公開範囲や保存状態は
 * それでも要るので、行ごと消さない。2 行目に置くものが何も無ければ 2 行目ごと出さない。
 * name が引けなければ「不明なユーザー」に倒す（ListGrantablePrincipals と同じ、行を消さず埋める約束）。
 */
export default function KbPageMeta({
  lastEditedBy,
  lastEditedAt,
  visibility,
  labels,
  viewCount,
  readMinutes,
  saveStatus,
  access = 'edit',
  actions,
}: KbPageMetaProps) {
  const hasEditor = Boolean(lastEditedBy && lastEditedAt);
  const hasStats = typeof viewCount === 'number' || (readMinutes ?? null) !== null;
  const saveLabel = saveStatus && saveStatus !== 'idle' ? SAVE_STATUS_LABEL[saveStatus] : '';
  const hasByline = hasEditor || saveStatus !== undefined || Boolean(actions);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-[var(--color-text-muted)]">
        <KbVisibilityBadge visibility={visibility} />
        {labels.map((label) => (
          <LabelChip key={label.id} name={label.name} color={label.color} />
        ))}
        {access !== 'edit' && (
          // 読むだけの人と書ける人で画面の見え方がほぼ同じなので、書けないことを言葉で示す。
          <span
            className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold leading-relaxed bg-surface-2 text-[var(--color-text-tertiary)]"
            title={access === 'comment' ? 'このページはコメントできますが、本文は編集できません' : 'このページは読むことだけできます'}
          >
            <FsIcon name="eye" className="h-3 w-3" />
            {access === 'comment' ? 'コメント可' : '閲覧のみ'}
          </span>
        )}
        {hasStats && typeof viewCount === 'number' && <span>閲覧 {viewCount}</span>}
        {hasStats && typeof readMinutes === 'number' && <span>読了 {readMinutes} 分</span>}
      </div>
      {hasByline && (
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-muted)]">
            {hasEditor && lastEditedBy && lastEditedAt && (
              <span className="flex items-center gap-2">
                <Avatar name={lastEditedBy.name || '不明なユーザー'} size="sm" />
                <span>
                  <span className="font-semibold text-[var(--color-text-primary)]">{lastEditedBy.name || '不明なユーザー'}</span>{' '}
                  が最終編集 · {formatMonthDay(lastEditedAt)} {formatHourMinute(lastEditedAt)}
                </span>
              </span>
            )}
            {saveStatus !== undefined && (
              <span role="status" aria-live="polite" aria-label="保存状態" className="inline-flex min-w-14 items-center gap-1.5 text-xs">
                {saveLabel !== '' && (
                  <span
                    aria-hidden="true"
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      saveStatus === 'saved' ? 'bg-success' : saveStatus === 'unsaved' ? 'bg-warning' : 'bg-[var(--color-text-muted)]'
                    }`}
                  />
                )}
                {saveLabel}
              </span>
            )}
          </div>
          {/* 広い画面では右端。狭い画面では折り返して最終編集の下に左ぞろえで置く（右に寄せると浮く）。 */}
          {actions && <div className="sm:ml-auto">{actions}</div>}
        </div>
      )}
    </div>
  );
}
