import { useMemo } from 'react';
import { Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useKbSpaceEntry } from '@/entities/kb';
import { EmptyState, ErrorNotice, Loading, fsIcon } from '@/shared/ui';
import { useKbFrameLocation } from '../model/kbFrameLocation';
import type { KbSpaceOutlet } from '../model/kbSpaceOutlet';

/**
 * KbSpaceLayout は /kb/spaces 以下（概要・すべてのページ・お気に入り・メンバー）に共通の親ルート。
 *
 * URL のスペースを解決し、枠（左の木と文脈バー）へ位置を知らせ、解決できるまでの読み込み中・
 * 見つからない・読み込めない・スペースが 1 つも無い、をここ 1 か所で出す。子の画面は解決済みの
 * スペースを useKbSpaceOutlet で受け取り、自分の中身だけを描く。
 *
 * 同じスペースの画面どうしを移っても、この親ルートは描き直されず取り直しもしない
 * （スペースの ID が変わったときだけ解決し直す）。
 */
export default function KbSpaceLayout() {
  const { spaceId } = useParams<{ spaceId?: string }>();
  const navigate = useNavigate();
  // スペース切替の「すべてのスペース」が対象ワークスペースを ?workspace= で持ち越す。
  // spaceId が既にあるとき（/kb/spaces/:spaceId）は無視してよい —— spaceId から
  // ワークスペースが一意に決まる。解決後の遷移先 URL にはこのクエリを持ち越さない。
  const [searchParams] = useSearchParams();
  const preferredWorkspaceSlug = spaceId ? undefined : (searchParams.get('workspace') ?? undefined);

  const { workspaceSlug, space, noSpaces, notFound, loading, error, retry } = useKbSpaceEntry(
    spaceId,
    (id) => navigate(`/kb/spaces/${id}`, { replace: true }),
    preferredWorkspaceSlug,
  );

  // スペースが決まるまでは undefined のまま（枠は前の木のまま）にして、同じスペースの
  // 画面どうしを移るたびに木を取り直さない。
  useKbFrameLocation({ workspaceSlug: workspaceSlug ?? undefined, spaceId: space?.id });

  const outlet = useMemo<KbSpaceOutlet | null>(
    () => (workspaceSlug && space ? { workspaceSlug, space } : null),
    [workspaceSlug, space],
  );

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
      {notFound ? (
        // 行き止まりにしない。素の /kb/spaces は最初に見つかったスペースを開く。
        <EmptyState
          headingLevel={1}
          icon={fsIcon('folder')}
          title="このスペースは見つかりませんでした"
          description="移動または削除された可能性があります。"
          action={{ label: 'スペース一覧へ戻る', onClick: () => navigate('/kb/spaces') }}
        />
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-6">
          <ErrorNotice message={error} onRetry={retry} className="w-full max-w-md" />
        </div>
      ) : noSpaces ? (
        <EmptyState
          headingLevel={1}
          icon={fsIcon('folder')}
          title="アクセスできるスペースがありません"
          description="左の列（狭い画面では左上のボタン）から、最初のスペースを作れます。"
        />
      ) : outlet && !loading ? (
        <Outlet context={outlet} />
      ) : (
        <Loading className="flex-1" />
      )}
    </main>
  );
}
