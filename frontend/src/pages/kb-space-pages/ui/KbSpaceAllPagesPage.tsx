import { useParams, useNavigate } from 'react-router-dom';
import { KbFrame, KbPageGlyph } from '@/widgets/kb-sidebar';
import { Loading, fsIcon } from '@/shared/ui';
import { KbRepository, KbSpaceHeading, NOTE_NEW_PAGE_TITLE, emitKbTreeEvent, useKbSpaceEntry } from '@/entities/kb';
import { useToast } from '@/shared/lib/hooks/useToast';
import EmptyState from '@/shared/ui/EmptyState';
import { useKbSpaceAllPages } from '../model/useKbSpaceAllPages';

/** すべてのページ（段14）。木を深さ優先で開いた、フラットな一覧。 */
export default function KbSpaceAllPagesPage() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();

  const { workspaceSlug, space, noSpaces, loading, error } = useKbSpaceEntry(spaceId, (id) =>
    navigate(`/kb/spaces/${id}`, { replace: true }),
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
            <KbSpaceHeading space={space} title="すべてのページ" />
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <AllPagesList
                workspaceSlug={workspaceSlug}
                spaceId={space.id}
                canCreate={space.role === 'admin' || space.role === 'editor'}
                onOpen={(id) => navigate(`/kb/${id}`)}
              />
            </div>
          </>
        )}
      </main>
    </KbFrame>
  );
}

function AllPagesList({
  workspaceSlug,
  spaceId,
  canCreate,
  onOpen,
}: {
  workspaceSlug: string;
  spaceId: string;
  /** このスペースでページを作れるか（編集者以上）。空のときに「ページを作る」を出す。 */
  canCreate: boolean;
  onOpen: (pageId: string) => void;
}) {
  const { pages, hasHiddenChildren, loading, error, retry } = useKbSpaceAllPages(workspaceSlug, spaceId);
  const { showToast } = useToast();

  // 空の画面から最初のページを作れるようにする（ナレッジの中にいるのに別の場所へ行かせない）。
  // 作ったらそのページを開く。
  const createFirstPage = async () => {
    try {
      const page = await KbRepository.createPage(workspaceSlug, spaceId, { title: NOTE_NEW_PAGE_TITLE });
      emitKbTreeEvent({ type: 'page-created', page });
      onOpen(page.id);
    } catch {
      showToast('error', 'ページを作成できませんでした');
    }
  };

  if (loading) return <Loading className="min-h-56" message="ページを読み込んでいます" />;

  if (error) {
    return (
      <EmptyState
        headingLevel={2}
        icon={fsIcon('alert-circle')}
        title="ページを読み込めませんでした"
        description="通信が切れたか、一時的な不調です。"
        action={{ label: '再読み込み', onClick: retry }}
      />
    );
  }

  if (!loading && pages.length === 0) {
    return (
      <EmptyState
        headingLevel={2}
        icon={fsIcon('document')}
        title={hasHiddenChildren ? '表示できるページがありません' : 'ページがありません'}
        description={
          hasHiddenChildren
            ? '表示できる範囲のページはありません。必要な場合は管理者にアクセスを確認してください。'
            : canCreate
              ? '最初のページを作ると、ここに並びます。'
              : 'まだページがありません。編集できる人がページを作ると、ここに並びます。'
        }
        action={!hasHiddenChildren && canCreate ? { label: 'ページを作る', onClick: () => void createFirstPage() } : undefined}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-6 pt-3 sm:px-6">
      <p className="mb-5 text-sm leading-relaxed text-[var(--color-text-muted)]">ページの階層をたどって、必要な情報を見つけましょう。</p>
    <ul className="divide-y divide-surface-2">
      {pages.map(({ page, depth }) => (
        <li key={page.id}>
          <button
            type="button"
            onClick={() => onOpen(page.id)}
            style={{ paddingLeft: `${16 + Math.min(depth, 4) * 12}px` }}
            className="flex min-h-14 w-full items-center gap-3 rounded-md px-4 py-3 text-left text-sm text-[var(--color-text-primary)] hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
          >
            <KbPageGlyph page={page} className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{page.title || '無題'}</span>
            {depth > 4 && <span className="ml-auto shrink-0 text-xs text-[var(--color-text-muted)]">{depth + 1}階層</span>}
          </button>
        </li>
      ))}
    </ul>
    </div>
  );
}
