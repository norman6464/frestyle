import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMediaQuery } from '@/shared/lib/hooks/useMediaQuery';
import { Button, FsIcon, PageFrame } from '@/shared/ui';
import { homeStrongLink } from '../lib/homeStyles';
import { useFavoritesWorkspace } from '../model/useFavoritesWorkspace';
import { useHomeWorkspaces } from '../model/useHomeWorkspaces';
import { useMyAssignedTickets } from '../model/useMyAssignedTickets';
import { usePageTicketReferences } from '../model/usePageTicketReferences';
import { useRecentPages } from '../model/useRecentPages';
import { useUnreadCount } from '../model/useUnreadCount';
import { useWorkspaceFavorites } from '../model/useWorkspaceFavorites';
import HomeAssignedSection from './HomeAssignedSection';
import HomeCreateDialog from './HomeCreateDialog';
import HomeFavoritesSection from './HomeFavoritesSection';
import HomeFirstRun from './HomeFirstRun';
import { HomeLoadingRows } from './HomePanelState';
import HomeResumeSection from './HomeResumeSection';
import HomeUnreadNotice from './HomeUnreadNotice';

function todayString(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * マイホーム。「知識を残し、その知識を使って仕事を進める」ための再開地点。
 *
 * - 主役は「続きからはじめる」（最後に開いたページ）。担当は補助として右の列（狭い画面では下）
 * - 履歴と担当はワークスペース横断。お気に入りとページ検索は選んだ 1 つのワークスペースの中
 * - 枠ごとに独立して読み、1 つの失敗でほかを隠さない。0 件と失敗は取り違えない
 * - どこにも所属していなければ初回ホーム（担当 0 件・履歴 0 件とは別の状態）
 *
 * 広い画面は左に再開とお気に入り、右に担当・未読・行き先。狭い画面は 未読 → 再開 → 担当 →
 * お気に入り の順に 1 列で、初めに出す件数を減らす。
 */
export default function HomePage() {
  const wide = useMediaQuery('(min-width: 1024px)');
  const workspaces = useHomeWorkspaces();
  const recent = useRecentPages();
  const latest = recent.status === 'ready' ? (recent.data[0] ?? null) : null;
  const references = usePageTicketReferences(latest);
  const assigned = useMyAssignedTickets();
  const unread = useUnreadCount();
  const [favoritesSlug, selectFavoritesSlug] = useFavoritesWorkspace(workspaces.data);
  const favorites = useWorkspaceFavorites(workspaces.status === 'ready' ? favoritesSlug : null);

  const [createOpen, setCreateOpen] = useState(false);
  const names = useMemo(() => new Map(workspaces.data.map((w) => [w.slug, w.name])), [workspaces.data]);
  // 表示名は所属一覧から引く。引けない間は slug のまま（名前を勝手に作らない）。
  const workspaceName = (slug: string) => names.get(slug) ?? slug;

  if (workspaces.status === 'ready' && workspaces.data.length === 0) {
    return <HomeFirstRun />;
  }

  const header = (
    <header className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-[var(--color-text-primary)] sm:text-4xl">マイホーム</h1>
        <p className="mt-3 text-base text-[var(--color-text-muted)]">
          続きをひらく。知識を取り出す。{wide && '次の作業へ。'}
        </p>
      </div>
      {workspaces.status === 'ready' && (
        // 狭い画面は「＋ つくる」と短く見せる。読み上げは常に「新しくつくる」（見える文字を含む名前）。
        <Button
          variant="secondary"
          size="lg"
          aria-label="新しくつくる"
          onClick={() => setCreateOpen(true)}
          className="shrink-0 font-semibold"
        >
          <FsIcon name="plus" className="h-5 w-5" />
          {wide ? '新しくつくる' : 'つくる'}
        </Button>
      )}
    </header>
  );

  if (workspaces.status === 'loading') {
    return (
      <PageFrame className="pb-24">
        {header}
        <div className="mt-8">
          <HomeLoadingRows label="ホームを読み込んでいます" rows={4} />
        </div>
      </PageFrame>
    );
  }

  const resume = <HomeResumeSection recent={recent} references={references} workspaceName={workspaceName} wide={wide} />;
  const assignedSection = <HomeAssignedSection assigned={assigned} wide={wide} today={todayString()} />;
  const favoritesSection = (
    <HomeFavoritesSection
      workspaces={workspaces}
      workspaceSlug={favoritesSlug}
      onSelectWorkspace={selectFavoritesSlug}
      favorites={favorites}
      wide={wide}
    />
  );

  return (
    <PageFrame className="pb-24">
      {header}
      {wide ? (
        <div className="mt-10 grid grid-cols-[minmax(0,1fr)_22rem] gap-12">
          <div className="flex min-w-0 flex-col gap-12">
            {resume}
            {favoritesSection}
          </div>
          <div className="flex min-w-0 flex-col gap-8 border-l border-surface-3 pl-10">
            {assignedSection}
            <HomeUnreadNotice unread={unread} wide />
            <nav aria-label="ほかの行き先" className="flex flex-col gap-4">
              <div>
                <Link to="/backlog" className={homeStrongLink}>
                  プロジェクトの作業へ <FsIcon name="arrow-right" className="h-4 w-4" />
                </Link>
                <p className="text-sm text-[var(--color-text-muted)]">スプリントやチームの優先順位はバックログで。</p>
              </div>
              <Link to="/kb/spaces" className={homeStrongLink}>
                スペースをひらく <FsIcon name="arrow-right" className="h-4 w-4" />
              </Link>
            </nav>
          </div>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-10">
          <HomeUnreadNotice unread={unread} wide={false} />
          {resume}
          {assignedSection}
          {favoritesSection}
        </div>
      )}
      <p className="mt-12 text-sm text-[var(--color-text-muted)]">
        最近のページと担当はワークスペース横断。お気に入りとページ検索は、選んだワークスペースの中。
      </p>
      {createOpen && (
        <HomeCreateDialog
          workspaces={workspaces.data}
          initialWorkspaceSlug={favoritesSlug}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </PageFrame>
  );
}
