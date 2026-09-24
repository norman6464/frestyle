import type { KbEditorRef, KbLabel } from '@/entities/kb';
import Avatar from '@/shared/ui/Avatar';
import LabelChip from '@/shared/ui/LabelChip';
import { formatHourMinute, formatMonthDay } from '@/shared/lib/formatters';
import { FsIcon } from '@/shared/ui';
import { SAVE_STATUS_LABEL, type SaveStatus } from '@/shared/ui/RichTextEditor';

export type KbPageVisibility = 'public' | 'space' | 'private';

/** 見ている人がこのページに何をできるか。編集できない人にだけ印を出す。 */
export type KbPageAccess = 'edit' | 'comment' | 'view';

export interface KbPageMetaProps {
  lastEditedBy?: KbEditorRef | null;
  lastEditedAt?: string | null;
  /** 公開範囲（段 13）。旧応答（デプロイ順）では undefined — 既定の 'space' として扱う。 */
  visibility?: KbPageVisibility;
  /** ページに付いたラベル（段 8）。旧応答では undefined。 */
  labels?: KbLabel[];
  /** このページを見たことのある人数（段 2）。旧応答では undefined — 出さない。 */
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
 * KbPageMeta は題名の下に出すバイライン（見本 3a）。
 *
 * 左から 最終編集（人と日時）→ 公開範囲 → ラベル → 権限の印、右端に 閲覧数・読了時間・保存状態。
 * 最終編集が無い（旧応答・未保存のページ）ときはその部分だけを省く — 公開範囲や保存状態は
 * それでも要るので、行ごと消さない。
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
}: KbPageMetaProps) {
  const hasEditor = Boolean(lastEditedBy && lastEditedAt);
  const hasStats = typeof viewCount === 'number' || (readMinutes ?? null) !== null;
  const saveLabel = saveStatus && saveStatus !== 'idle' ? SAVE_STATUS_LABEL[saveStatus] : '';

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-surface-3 pb-4 text-xs text-[var(--color-text-muted)]">
      {hasEditor && lastEditedBy && lastEditedAt && (
        <span className="flex items-center gap-2">
          <Avatar name={lastEditedBy.name || '不明なユーザー'} size="sm" />
          <span>
            <span className="font-semibold text-[var(--color-text-secondary)]">{lastEditedBy.name || '不明なユーザー'}</span>{' '}
            が最終編集 · {formatMonthDay(lastEditedAt)} {formatHourMinute(lastEditedAt)}
          </span>
        </span>
      )}
      <KbVisibilityBadge visibility={visibility ?? 'space'} />
      {(labels ?? []).map((label) => (
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
      <span className="ml-auto flex items-center gap-3">
        {hasStats && typeof viewCount === 'number' && <span>閲覧 {viewCount}</span>}
        {hasStats && typeof readMinutes === 'number' && <span>読了 {readMinutes} 分</span>}
        {saveStatus !== undefined && (
          <span role="status" aria-live="polite" aria-label="保存状態" className="inline-flex min-w-14 items-center justify-end gap-1.5">
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
      </span>
    </div>
  );
}
