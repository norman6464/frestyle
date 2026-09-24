import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { KbSidebar } from '@/widgets/kb-sidebar';
import { SidebarSection, FsIcon, type FsIconName } from '@/shared/ui';
import { useKbSpaceEntry, KbSpaceTabs, kbRoleLabel } from '@/entities/kb';

/**
 * KbSpaceOverviewPage はスペースの「概要」画面（段14）。
 *
 * 役割の確認と、ナレッジを読むための入口をまとめる。未取得の件数などは表示しない。
 */
export default function KbSpaceOverviewPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();
  // 柱の「すべてのスペース」が対象ワークスペースを ?workspace= で持ち越す（FRESTYLE-596 の
  // 残り）。spaceId が既にあるとき（/kb/spaces/:spaceId）は無視してよい —— spaceId から
  // ワークスペースが一意に決まる。解決後の遷移先 URL にはこのクエリを持ち越さない
  // （スペースが決まれば対象は URL の中に無くても一意）。
  const [searchParams] = useSearchParams();
  const preferredWorkspaceSlug = spaceId ? undefined : (searchParams.get('workspace') ?? undefined);

  const { workspaceSlug, space, noSpaces, loading, error } = useKbSpaceEntry(
    spaceId,
    (id) => navigate(`/kb/spaces/${id}`, { replace: true }),
    preferredWorkspaceSlug,
  );

  return (
    <div className="flex h-full overflow-hidden">
      {/* サイドバーは noSpaces（ワークスペースそのものが無い／どこにもスペースが無い）でも
          常に描く。KbSidebar は空のワークスペース／空のスペース一覧をそれぞれ
          自分で検知して作成フォームを出す（zero-state からの唯一の抜け道）。ここで
          早期 return して隠すと、その抜け道ごと失われる（実際に起きていた不具合）。 */}
      <SidebarSection>
        <KbSidebar workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''} />
      </SidebarSection>

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {error && (
          <div role="alert" className="flex flex-1 items-center justify-center px-6 py-8 text-center text-sm text-[var(--color-text-muted)]">
            {error}
          </div>
        )}

        {!error && noSpaces && (
          <div className="flex flex-1 items-center justify-center px-6 text-center">
            <div>
              <h1 className="mb-2 text-lg font-semibold text-[var(--color-text-secondary)]">
                アクセスできるスペースがありません
              </h1>
              <p className="text-sm text-[var(--color-text-muted)]">
                メニューの「ナレッジ」からワークスペースまたはスペースを作ると使えるようになります。
              </p>
            </div>
          </div>
        )}

        {!error && !noSpaces && (loading || !space || !workspaceSlug) && (
          <div role="status" className="flex flex-1 items-center justify-center py-8 text-sm text-[var(--color-text-muted)]">
            読み込み中…
          </div>
        )}

        {!error && !noSpaces && space && workspaceSlug && (
          <>
            <KbSpaceTabs space={space} active="overview" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-6 sm:px-6 sm:py-8">
              <div className="mx-auto max-w-3xl">
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">知っていることを、チームの力に。</h2>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)]">ページを読んで背景をつかみ、必要な情報を見つけましょう。</p>
                <div className="mt-6 grid gap-4 sm:grid-cols-2">
                  {([
                    { suffix: 'pages', label: 'ナレッジを開く', description: 'ページを一覧から探して、作業の背景を確認。', icon: 'book' },
                    { suffix: 'favorites', label: 'お気に入りを開く', description: 'ワークスペース内で保存したページに、すぐ戻る。', icon: 'star' },
                  ] satisfies { suffix: string; label: string; description: string; icon: FsIconName }[]).map(({ suffix, label, description, icon }) => (
                    <Link key={suffix} to={`/kb/spaces/${space.id}/${suffix}`} className="group rounded-xl border border-surface-3 bg-surface-1 p-5 hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">
                      <FsIcon name={icon} className="mb-4 h-6 w-6 text-[var(--color-text-muted)]" />
                      <span className="flex items-center justify-between gap-2 font-semibold text-[var(--color-text-primary)]">{label}<FsIcon name="arrow-right" className="h-4 w-4 shrink-0" /></span>
                      <span className="mt-2 block text-sm leading-relaxed text-[var(--color-text-muted)]">{description}</span>
                    </Link>
                  ))}
                </div>
                <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-surface-3 pt-4">
                  <p className="text-sm text-[var(--color-text-tertiary)]">このスペースでの自分の役割: {kbRoleLabel(space.role)}</p>
                  <Link to={`/kb/spaces/${space.id}/members`} className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-brand-700 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600">メンバーを確認</Link>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
