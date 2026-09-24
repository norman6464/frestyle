import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { KbFrame } from '@/widgets/kb-sidebar';
import { useKbSpaceEntry, KbSpaceHeading, kbRoleLabel } from '@/entities/kb';

/**
 * KbSpaceOverviewPage はスペースの「概要」画面（段14）。
 *
 * スペースの説明と自分の役割を出す。画面の行き来（すべてのページ・お気に入り・メンバー）は
 * 左の列と文脈バーが持つので、ここに入口を並べ直さない。未取得の件数などは表示しない。
 */
export default function KbSpaceOverviewPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();
  // スペース切替の「すべてのスペース」が対象ワークスペースを ?workspace= で持ち越す。
  // spaceId が既にあるとき（/kb/spaces/:spaceId）は無視してよい —— spaceId から
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
    // ナレッジの枠（文脈バー・左の木）。スペースが無い／決まらないときも枠は描く —— 左の列が
    // 空のワークスペース・空のスペース一覧を検知して作成の欄を出す（そこが始める唯一の入口）。
    <KbFrame workspaceSlug={workspaceSlug ?? undefined} spaceId={space?.id ?? ''}>
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
                左の列（狭い画面では左上のボタン）から、最初のスペースを作れます。
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
            <KbSpaceHeading space={space} />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-6 pt-4 sm:px-6 sm:pb-8">
              <div className="mx-auto max-w-3xl">
                <h2 className="text-xl font-semibold text-[var(--color-text-primary)]">知っていることを、チームの力に。</h2>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-text-muted)]">ページを読んで背景をつかみ、必要な情報を見つけましょう。</p>
                {/* 画面の行き来（すべてのページ・お気に入り・メンバー）は左の列と文脈バーが持つ。
                    ここに同じ入口を並べ直さない。 */}
                <p className="mt-8 border-t border-surface-3 pt-4 text-sm text-[var(--color-text-tertiary)]">
                  このスペースでの自分の役割: {kbRoleLabel(space.role)}
                </p>
              </div>
            </div>
          </>
        )}
      </main>
    </KbFrame>
  );
}
