import type { KbEditorRef, KbLabel } from '@/entities/kb';
import Avatar from '@/shared/ui/Avatar';
import LabelChip from '@/shared/ui/LabelChip';
import { formatHourMinute, formatMonthDay } from '@/shared/lib/formatters';
import { FsIcon } from '@/shared/ui';

export type KbPageVisibility = 'public' | 'space' | 'private';

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
}

const VISIBILITY_LABEL: Record<KbPageVisibility, string> = {
  public: '全体公開',
  space: 'スペース',
  private: '非公開',
};

/** 公開範囲バッジ。'space'（既定）は目立たせず、'private' だけ制限が強いことが分かる見た目にする。 */
function KbVisibilityBadge({ visibility }: { visibility: KbPageVisibility }) {
  if (visibility === 'public') {
    return (
      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-semibold leading-relaxed bg-brand-100 text-brand-800">
        {VISIBILITY_LABEL.public}
      </span>
    );
  }
  if (visibility === 'private') {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-taupe-600 px-1.5 py-0.5 text-[11px] font-semibold leading-relaxed text-white">
        <FsIcon name="lock" className="h-2.5 w-2.5" />
        {VISIBILITY_LABEL.private}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-taupe-100 px-1.5 py-0.5 text-[11px] font-semibold leading-relaxed text-taupe-600">
      {VISIBILITY_LABEL.space}
    </span>
  );
}

/**
 * KbPageMeta は題名の下に出すバイライン。
 *
 * lastEditedBy / lastEditedAt が無ければ何も出さない（旧応答・未保存のページの
 * どちらも該当し得る。無いことを匂わせる空欄を置かない）。
 * name が引けなければ「不明なユーザー」に倒す（ListGrantablePrincipals と同じ、
 * 行を消さず埋める約束）。
 *
 * 公開範囲バッジ・ラベルチップ・閲覧数・読了時間は段13/段2で足された付随情報で、
 * どれも省略可（無ければその部分だけ出さない）。
 */
export default function KbPageMeta({
  lastEditedBy,
  lastEditedAt,
  visibility,
  labels,
  viewCount,
  readMinutes,
}: KbPageMetaProps) {
  if (!lastEditedBy || !lastEditedAt) return null;

  const hasStats = typeof viewCount === 'number' || (readMinutes ?? null) !== null;

  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-surface-3 pb-4 text-xs text-[var(--color-text-muted)]">
      <span className="flex items-center gap-2">
        <Avatar name={lastEditedBy.name || '不明なユーザー'} size="sm" />
        <span>
          最終編集 {lastEditedBy.name || '不明なユーザー'} · {formatMonthDay(lastEditedAt)}{' '}
          {formatHourMinute(lastEditedAt)}
        </span>
      </span>
      <KbVisibilityBadge visibility={visibility ?? 'space'} />
      {(labels ?? []).map((label) => (
        <LabelChip key={label.id} name={label.name} color={label.color} />
      ))}
      {hasStats && (
        <span className="ml-auto flex items-center gap-3">
          {typeof viewCount === 'number' && <span>閲覧 {viewCount}</span>}
          {typeof readMinutes === 'number' && <span>読了 {readMinutes} 分</span>}
        </span>
      )}
    </div>
  );
}
