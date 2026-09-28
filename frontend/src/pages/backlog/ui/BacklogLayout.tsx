import { useMemo } from 'react';
import { Outlet, useNavigate, useParams } from 'react-router-dom';
import { EmptyState, ErrorNotice, Loading, NameCreateForm, fsIcon } from '@/shared/ui';
import { useBacklogProject } from '../model/useBacklogProject';
import { useCreateProject } from '../model/useCreateProject';
import { backlogPath } from '../model/backlogView';
import type { BacklogOutlet } from '../model/backlogOutlet';

/**
 * BacklogLayout はバックログの面（一覧・アーカイブ・設定）に共通の親ルート。
 *
 * URL のプロジェクトを解決し、解決できるまでの読み込み中・見つからない・読み込めない・
 * プロジェクトが 1 つも無い、をここ 1 か所で出す。素の /backlog は最初に見つかったプロジェクトへ
 * 移す。子の面は解決済みのプロジェクトを useBacklogOutlet で受け取り、自分の中身だけを描く。
 */
export default function BacklogLayout() {
  const { projectId } = useParams<{ projectId?: string }>();
  const navigate = useNavigate();
  const { workspaceSlug, project, noProjects, notFound, loading, error, retry } = useBacklogProject(projectId, (id) =>
    navigate(backlogPath(id, 'backlog'), { replace: true }),
  );
  const createProject = useCreateProject(workspaceSlug ?? undefined);

  const outlet = useMemo<BacklogOutlet | null>(
    () => (workspaceSlug && project ? { workspaceSlug, project } : null),
    [workspaceSlug, project],
  );
  if (outlet && !loading) return <Outlet context={outlet} />;

  return (
    // 面の枠（BacklogFrame）と同じ列に置く。解決できたあとの見出しと左端をそろえる。
    <div className="flex h-full overflow-hidden">
      <div className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col overflow-hidden">
        {notFound ? (
          // 行き止まりにしない。素の /backlog は最初に見つかったプロジェクトを開く。
          <EmptyState
            headingLevel={1}
            icon={fsIcon('folder')}
            title="このプロジェクトは見つかりませんでした"
            description="移動または削除された可能性があります。"
            action={{ label: 'バックログへ戻る', onClick: () => navigate('/backlog') }}
          />
        ) : error ? (
          <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
            <ErrorNotice message={error} onRetry={retry} className="w-full max-w-md" />
          </div>
        ) : noProjects ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <p className="mb-1 text-base font-semibold text-[var(--color-text-secondary)]">
                プロジェクトがありません
              </p>
              <p className="mb-4 text-sm text-[var(--color-text-muted)]">
                プロジェクトを作るとバックログを使えるようになります。
              </p>
              {workspaceSlug && (
                <div className="mx-auto max-w-sm text-left">
                  <NameCreateForm
                    what="プロジェクト"
                    onCreate={async ({ name }) => {
                      const created = await createProject({ name });
                      navigate(backlogPath(created.id, 'backlog'));
                    }}
                  />
                </div>
              )}
            </div>
          </div>
        ) : (
          <Loading className="flex-1" />
        )}
      </div>
    </div>
  );
}
