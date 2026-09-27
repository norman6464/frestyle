import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProjectRepository, type Project } from '@/entities/project';
import { EmptyNotice, ErrorNotice, FsIcon, SkeletonRows } from '@/shared/ui';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';

export interface BacklogProjectSwitcherProps {
  workspaceSlug: string | undefined;
  /** 今いるプロジェクト。 */
  project: Project;
}

const NO_PROJECTS: Project[] = [];

/**
 * BacklogProjectSwitcher はバックログの文脈の行（設計ボード ST08 の「FreStyle / プロジェクト FRE ▾」）の
 * 「プロジェクト FRE ▾」。押すと同じワークスペースのプロジェクトの一覧が開き、選ぶとそのバックログへ移る。
 *
 * 面の切替（バックログ / アーカイブ / 設定）は同じ行の右端のタブが持つ。ここはプロジェクトを
 * 選ぶことだけを持つ（同じ行き先を 2 か所に置かない）。
 */
export default function BacklogProjectSwitcher({ workspaceSlug, project }: BacklogProjectSwitcherProps) {
  const [open, setOpen] = useState(false);
  // 再試行の引き金（値に意味は無い。増えたら同じ問い合わせをもう一度投げる）。
  const [attempt, setAttempt] = useState(0);
  // 一覧の取得の結果は「どの問い合わせの結果か」の鍵と一緒に持つ。今の鍵の結果がまだ無い間が
  // 読み込み中（effect の頭で「読み込み中」へ戻すと、描いた直後にもう 1 回描き直す）。
  // 読み込み中・失敗・0 件を同じ「プロジェクトはありません」に畳まない（失敗を「無い」と
  // 言い切ると、あるのに切り替えられないと誤解される）。
  const requestKey = `${workspaceSlug ?? ''}#${attempt}`;
  const [result, setResult] = useState<
    { key: string; status: 'ready'; projects: Project[] } | { key: string; status: 'error' } | null
  >(null);
  const listStatus = result?.key === requestKey ? result.status : 'loading';
  const projects = result?.key === requestKey && result.status === 'ready' ? result.projects : NO_PROJECTS;
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const key = project.key.toUpperCase();

  // 外を押したら・Escape で閉じる（ナレッジの切替と同じ作り）。Escape のときは引き金へ戻す。
  useDismissOnOutside(open, [containerRef], () => setOpen(false), { returnFocus: triggerRef });

  // 開いたときだけ一覧を取る（閉じている間は要らない問い合わせを出さない）。
  useEffect(() => {
    if (!open || !workspaceSlug) return;
    let alive = true;
    const forKey = `${workspaceSlug}#${attempt}`;
    void ProjectRepository.fetchProjects(workspaceSlug)
      .then((list) => {
        if (alive) setResult({ key: forKey, status: 'ready', projects: list });
      })
      .catch(() => {
        // 一覧が取れなくても今のプロジェクトは開いたまま使える（fail-open）。失敗は失敗と示す。
        if (alive) setResult({ key: forKey, status: 'error' });
      });
    return () => {
      alive = false;
    };
  }, [open, workspaceSlug, attempt]);

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        // 見えている「プロジェクト FRE」を名前に含め、押すと何が起きるかを足す。
        aria-label={`プロジェクト ${key} を切り替える`}
        className="inline-flex min-h-9 items-center gap-1 rounded-md px-1.5 text-[var(--color-text-muted)] transition-colors hover:bg-surface-2 hover:text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 [@media(pointer:coarse)]:min-h-11"
      >
        <span>プロジェクト {key}</span>
        <FsIcon name="chevron-down" className="h-3.5 w-3.5 shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-64 max-w-[calc(100vw-2rem)] rounded-md border border-surface-3 bg-surface-1 p-1 shadow-lg">
          {listStatus === 'loading' ? (
            <SkeletonRows label="プロジェクトを読み込み中" shape="blocks" size="sm" className="px-2 py-1.5" />
          ) : listStatus === 'error' ? (
            <ErrorNotice
              variant="inline"
              message="プロジェクトを読み込めませんでした"
              onRetry={() => setAttempt((prev) => prev + 1)}
              className="px-2 py-1"
            />
          ) : projects.length === 0 ? (
            // 今のプロジェクトも一覧に並ぶので、0 件は「ほかの」ではなく「無い」。
            <EmptyNotice title="切り替えられるプロジェクトはありません" className="px-2 py-1.5" />
          ) : (
            projects.map((p) => (
              <Link
                key={p.id}
                to={`/backlog/${p.id}`}
                // 今いるプロジェクトの印。'page' にしないのは、同じプロジェクトの設定やアーカイブを
                // 開いていても、このリンク（バックログ）が「今のページ」だと読まれてしまうため。
                aria-current={p.id === project.id ? 'true' : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-9 items-center gap-2 rounded-md px-2 text-sm transition-colors ${
                  p.id === project.id
                    ? 'bg-[var(--color-nav-selected)] font-medium text-[var(--color-nav-selected-text)]'
                    : 'text-[var(--color-text-tertiary)] hover:bg-surface-2'
                }`}
              >
                <span className="truncate">{p.name}</span>
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}
