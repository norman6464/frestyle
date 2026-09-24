import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ProjectRepository, type Project } from '@/entities/project';
import { FsIcon } from '@/shared/ui';
import { useDismissOnOutside } from '@/shared/lib/hooks/useDismissOnOutside';

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
 * BacklogSidebar はバックログの柱。プロジェクトの切替だけを持つ。
 *
 * 面の切替（バックログ / アーカイブ / 設定）・スプリント・保存した絞り込みは**持たない**。
 * 設計ボード ST08 はそれらを本文側（見出しの右のタブ、一覧の上の絞り込みタブ、本文の段）に
 * 置いており、行き先が柱と本文の 2 か所にあるとどちらが正か分からなくなるため。
 * ナレッジの KbSidebar とは別物で、ページの木もスペースの切替も持たない
 * （バックログは projects にしか属さない）。
 */
export default function BacklogSidebar({ workspaceSlug, project, onOpenSearch }: BacklogSidebarProps) {
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);
  // 一覧の取得の状態。読み込み中・失敗・0 件を同じ「ほかのプロジェクトはありません」に
  // 畳まない（失敗を「無い」と言い切ると、あるのに切り替えられないと誤解される）。
  const [listStatus, setListStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // 再試行の引き金（値に意味は無い。増えたら同じ問い合わせをもう一度投げる）。
  const [attempt, setAttempt] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // 外を押したら・Escape で閉じる（ナレッジの切替と同じ作り）。Escape のときは引き金へ戻す。
  useDismissOnOutside(switcherOpen, [containerRef], () => setSwitcherOpen(false), { returnFocus: triggerRef });

  // 切替を開いたときだけ一覧を取る（閉じている間は要らない問い合わせを出さない）。
  useEffect(() => {
    if (!switcherOpen || !workspaceSlug) return;
    let alive = true;
    setListStatus('loading');
    void ProjectRepository.fetchProjects(workspaceSlug)
      .then((list) => {
        if (!alive) return;
        setProjects(list);
        setListStatus('ready');
      })
      .catch(() => {
        // 一覧が取れなくても今のプロジェクトは開いたまま使える（fail-open）。失敗は失敗と示す。
        if (alive) setListStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [switcherOpen, workspaceSlug, attempt]);

  if (!project) return null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={containerRef} className="relative mb-2">
        <button
          ref={triggerRef}
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
          <FsIcon name="chevron-up-down" className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
        </button>

        {switcherOpen && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1 rounded-md border border-surface-3 bg-surface-1 p-1 shadow-lg">
            {listStatus === 'loading' ? (
              <p role="status" className="px-2 py-1.5 text-xs text-[var(--color-text-muted)]">
                読み込み中…
              </p>
            ) : listStatus === 'error' ? (
              <div role="alert" className="flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-danger-ink">
                <span>プロジェクトを読み込めませんでした</span>
                <button
                  type="button"
                  onClick={() => setAttempt((prev) => prev + 1)}
                  className="shrink-0 rounded px-1.5 py-1 underline hover:no-underline"
                >
                  再試行
                </button>
              </div>
            ) : projects.length === 0 ? (
              // 今のプロジェクトも一覧に並ぶので、0 件は「ほかの」ではなく「無い」。
              <p className="px-2 py-1.5 text-xs text-[var(--color-text-muted)]">切り替えられるプロジェクトはありません</p>
            ) : (
              projects.map((p) => (
                <Link
                  key={p.id}
                  to={`/backlog/${p.id}`}
                  aria-current={p.id === project.id ? 'page' : undefined}
                  onClick={() => setSwitcherOpen(false)}
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
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

      {onOpenSearch && (
        <button
          type="button"
          onClick={onOpenSearch}
          className="mb-1 flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-[var(--color-text-muted)] transition-colors hover:bg-surface-2"
        >
          <FsIcon name="search" className="h-3.5 w-3.5 shrink-0" />
          <span>検索</span>
        </button>
      )}

    </div>
  );
}
