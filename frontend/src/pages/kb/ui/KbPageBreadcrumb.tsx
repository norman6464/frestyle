import { Link } from 'react-router-dom';
import type { KbAncestorRef } from '@/entities/kb';
import { useKbFrameSpace } from '@/widgets/kb-sidebar';

export interface KbPageBreadcrumbProps {
  workspaceSlug: string;
  workspaceName?: string;
  /** 今のページのスペース。枠が持つスペースと一致したときだけ、その名前を段として出す。 */
  spaceId: string;
  /** 閲覧できる祖先だけが根から順に入る。見えない祖先は行ごと無い（穴があき得る）。 */
  ancestors: KbAncestorRef[];
  title: string;
}

const CRUMB_LINK_CLASS =
  'inline-flex min-h-11 max-w-40 items-center truncate rounded px-1 hover:text-[var(--color-text-primary)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600';

/**
 * KbPageBreadcrumb はページの場所（見本 3a のパンくず）。
 * ワークスペース → スペース → 閲覧できる祖先 → 現在のページ。
 *
 * 先頭のワークスペースと次のスペースもリンクにする — 場所の表示は、そこへ戻る道でもある。
 * スペースの名前はページの応答に無いので、枠（KbFrame）が木のために持っているスペースを
 * コンテキストで受け取る。枠の中で描かれる部品として切り出してあるのはそのため
 * （KbFrame を描く側（KbPage）自身は Provider の外にいるので、そこでは受け取れない）。
 * 見えない祖先は応答に含まれず、穴があいたまま出す（木と同じ見え方。フロントで埋めると、
 * サーバーが伏せた実在を推測で喋ることになる）。省いた題名の全文はホバー（title）で読める。
 */
export default function KbPageBreadcrumb({ workspaceSlug, workspaceName, spaceId, ancestors, title }: KbPageBreadcrumbProps) {
  const frameSpace = useKbFrameSpace();
  const space = frameSpace && frameSpace.id === spaceId ? frameSpace : null;

  return (
    <nav aria-label="ページの場所" className="mb-2 flex min-w-0 flex-wrap items-center gap-1 text-xs text-[var(--color-text-muted)]">
      <Link to={`/kb/spaces?workspace=${encodeURIComponent(workspaceSlug)}`} className={CRUMB_LINK_CLASS}>
        {workspaceName ?? workspaceSlug}
      </Link>
      {space && (
        <span className="flex min-w-0 items-center gap-1">
          <span aria-hidden="true">/</span>
          <Link to={`/kb/spaces/${space.id}`} title={space.name} className={CRUMB_LINK_CLASS}>
            {space.name}
          </Link>
        </span>
      )}
      {ancestors.map((ancestor) => (
        <span key={ancestor.id} className="flex min-w-0 items-center gap-1">
          <span aria-hidden="true">/</span>
          <Link to={`/kb/${ancestor.id}`} title={ancestor.title} className={CRUMB_LINK_CLASS}>
            {ancestor.title}
          </Link>
        </span>
      ))}
      {/* 区切りは題名と組にして折り返す（独立させると「/」だけが行末に残る） */}
      <span className="flex min-w-0 items-center gap-1">
        <span aria-hidden="true">/</span>
        <span aria-current="page" title={title} className="max-w-40 truncate text-[var(--color-text-secondary)]">
          {title}
        </span>
      </span>
    </nav>
  );
}
