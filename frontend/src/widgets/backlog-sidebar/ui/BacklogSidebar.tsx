import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronUpDownIcon, MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { ProjectRepository, type Project } from '@/entities/project';
import BacklogSavedFilters from './BacklogSavedFilters';
import { useBacklogFilterCounts } from '../model/useBacklogFilterCounts';

export interface BacklogSidebarProps {
  workspaceSlug: string | undefined;
  /** 今いるプロジェクト。解決前は null（顔は出さず、絞り込みも出さない）。 */
  project: Project | null;
  /** 題名の検索を開く。渡されなければ検索の行を出さない。 */
  onOpenSearch?: () => void;
}

/**
 * 角の印に出す 2 文字。プロジェクトの鍵（チケットキーの接頭辞。FRESTYLE-12 の FRESTYLE）から
 * 取る — 名前と違って改名で変わらず、チケットのキーとも揃う。自動採番の鍵（p-1a2b3c）は
 * 記号を落としてから 2 文字取る。
 */
function projectInitials(key: string): string {
  const letters = key.replace(/[^A-Za-z0-9]/g, '');
  return (letters.slice(0, 2) || key.slice(0, 2)).toUpperCase();
}

/**
 * BacklogSidebar はバックログの柱。プロジェクトの切替と、どう絞るかだけを持つ。
 *
 * 面の切替（バックログ / 状態と種別 / アーカイブ）とスプリントは**持たない** —— 見本の
 * Jira はそれを本文のタブ列と本文の段に置いており、行き先が柱と本文の 2 か所にあると
 * どちらが正か分からなくなるため。ナレッジの KbSidebar とは別物で、ページの木も
 * スペースの切替も持たない（バックログは projects にしか属さない）。
 */
export default function BacklogSidebar({ workspaceSlug, project, onOpenSearch }: BacklogSidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  const counts = useBacklogFilterCounts(workspaceSlug, project?.id);

  // 切替を開いたときだけ一覧を取る（閉じている間は要らない問い合わせを出さない）。
  useEffect(() => {
    if (!switcherOpen || !workspaceSlug) return;
    let alive = true;
    void ProjectRepository.fetchProjects(workspaceSlug)
      .then((list) => {
        if (alive) setProjects(list);
      })
      .catch(() => {
        // 一覧が取れなくても今のプロジェクトは開いたまま使える（fail-open）。
        if (alive) setProjects([]);
      });
    return () => {
      alive = false;
    };
  }, [switcherOpen, workspaceSlug]);

  if (!project) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="relative mb-2">
        <button
          type="button"
          onClick={() => setSwitcherOpen((prev) => !prev)}
          aria-expanded={switcherOpen}
          aria-label="プロジェクトを切り替える"
          className="flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-1.5 text-left hover:bg-surface-2"
        >
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-600 text-xs font-semibold text-white"
          >
            {projectInitials(project.key)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-[var(--color-text-primary)]">
              {project.name}
            </span>
            <span className="block truncate text-xs text-[var(--color-text-muted)]">
              プロジェクト・{project.key.toUpperCase()}
            </span>
          </span>
          <ChevronUpDownIcon className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" aria-hidden="true" />
        </button>

        {switcherOpen && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-surface-3 bg-surface-1 p-1 shadow-lg">
            {projects.length === 0 ? (
              <p className="px-2 py-1.5 text-xs text-[var(--color-text-muted)]">ほかのプロジェクトはありません</p>
            ) : (
              projects.map((p) => (
                <Link
                  key={p.id}
                  to={`/backlog/${p.id}`}
                  onClick={() => setSwitcherOpen(false)}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
                    p.id === project.id
                      ? 'bg-brand-500/10 font-medium text-brand-700'
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

      {onOpenSearch && (
        <button
          type="button"
          onClick={onOpenSearch}
          className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-surface-2"
        >
          <MagnifyingGlassIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>検索</span>
        </button>
      )}

      <BacklogSavedFilters projectId={project.id} counts={counts} />
    </div>
  );
}
