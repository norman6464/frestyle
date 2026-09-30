import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMediaQuery } from '@/shared/lib/hooks/useMediaQuery';
import { useLocalToday } from '@/shared/lib/hooks/useLocalToday';
import { FsIcon, SkeletonRows } from '@/shared/ui';
import { homeBoxRowLink, homeContainer } from '../lib/homeStyles';
import { useFavoritesWorkspace } from '../model/useFavoritesWorkspace';
import { useHomeWorkspaces } from '../model/useHomeWorkspaces';
import { useMyAssignedTickets } from '../model/useMyAssignedTickets';
import { useRecentPages } from '../model/useRecentPages';
import { useUnreadCount } from '../model/useUnreadCount';
import { useWorkspaceFavorites } from '../model/useWorkspaceFavorites';
import HomeAssignedSection from './HomeAssignedSection';
import HomeCreateButton from './HomeCreateButton';
import HomeFavoritesSection from './HomeFavoritesSection';
import HomeFirstRun from './HomeFirstRun';
import HomeResumeSection from './HomeResumeSection';
import HomeUnreadNotice from './HomeUnreadNotice';

/**
 * マイホーム。「知識を残し、その知識を使って仕事を進める」ための再開地点。
 *
 * - 主役は「続きからはじめる」（最後に開いたページ）。ヘッダー直下の帯に、等幅のカードで並ぶ
 * - 履歴と担当はワークスペース横断。お気に入りとページ検索は選んだ 1 つのワークスペースの中
 * - 枠ごとに独立して読み、1 つの失敗でほかを隠さない。0 件と失敗は取り違えない
 * - どこにも所属していなければ初回ホーム（担当 0 件・履歴 0 件とは別の状態）
 *
 * 面の作りは報道系サイトの一覧面に合わせる：画面の名前や説明文は帯に出さず（読み上げにだけ残す）、
 * 全幅の灰色の帯にカードを並べ、その下に白い本文。本文は中央 1125px の器で、広い画面は左に担当と
 * お気に入り、右の脇柱（308px）に薄い青の箱（未読・行き先）。狭い画面は 帯 → 未読 → 担当 →
 * お気に入り の順に 1 列で、初めに出す件数を減らす。
 */
export default function HomePage() {
  const wide = useMediaQuery('(min-width: 1024px)');
  // 期限切れの判定に使う「今日」。日付が変わったら更新する（開いたまま日付をまたいでもずれない）。
  const today = useLocalToday();
  const workspaces = useHomeWorkspaces();
  const recent = useRecentPages();
  const assigned = useMyAssignedTickets();
  const unread = useUnreadCount();
  const [favoritesSlug, selectFavoritesSlug] = useFavoritesWorkspace(workspaces.data);
  const favorites = useWorkspaceFavorites(workspaces.status === 'ready' ? favoritesSlug : null);

  if (workspaces.status === 'ready' && workspaces.data.length === 0) {
    return <HomeFirstRun />;
  }

  // 画面の名前は帯に見出しとしては出さない（帯は特集面の作りで、行き先はヘッダーが示している）。
  // 読み上げの見出しとしてだけ残す。
  const title = <h1 className="sr-only">マイホーム</h1>;
  // 全幅の灰色の帯。中の器は本文と同じ幅。
  const band = (children: ReactNode) => (
    <div className="border-b border-surface-3 bg-[var(--color-surface-band)]">
      <div className={`${homeContainer} py-6 lg:py-[30px]`}>{children}</div>
    </div>
  );

  if (workspaces.status === 'loading') {
    return (
      <div className="pb-24">
        {title}
        {band(<SkeletonRows label="ホームを読み込んでいます" rows={3} className="py-4" />)}
      </div>
    );
  }

  const resume = (
    <HomeResumeSection
      recent={recent}
      wide={wide}
      action={
        <HomeCreateButton workspaces={workspaces.data} initialWorkspaceSlug={favoritesSlug} wide={wide} />
      }
    />
  );
  const assignedSection = <HomeAssignedSection assigned={assigned} wide={wide} today={today} />;
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
    <div className="pb-24">
      {title}
      {band(resume)}
      {wide ? (
        <div className={`${homeContainer} mt-8 grid grid-cols-[minmax(0,1fr)_308px] gap-10`}>
          <div className="flex min-w-0 flex-col gap-10">
            {assignedSection}
            {favoritesSection}
          </div>
          <aside className="min-w-0">
            {/* 脇柱の箱。薄い青の面に、見出しと白い段（未読・行き先）を重ねる（報道系サイトの宣伝箱の作り）。 */}
            <div className="bg-brand-100 p-3">
              <p className="py-1 text-center text-base font-bold text-brand-800">次の作業へ</p>
              <div className="mt-2 flex flex-col gap-2">
                <HomeUnreadNotice unread={unread} wide />
                <nav aria-label="ほかの行き先" className="flex flex-col gap-2">
                  <Link to="/backlog" className={homeBoxRowLink}>
                    <FsIcon name="backlog" className="h-5 w-5 shrink-0 text-brand-700" />
                    <span className="min-w-0 flex-1">プロジェクトの作業へ</span>
                    <FsIcon name="arrow-right" className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                  </Link>
                  <Link to="/kb/spaces" className={homeBoxRowLink}>
                    <FsIcon name="knowledge" className="h-5 w-5 shrink-0 text-brand-700" />
                    <span className="min-w-0 flex-1">スペースをひらく</span>
                    <FsIcon name="arrow-right" className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
                  </Link>
                </nav>
              </div>
            </div>
          </aside>
        </div>
      ) : (
        <div className={`${homeContainer} mt-6 flex flex-col gap-10`}>
          <HomeUnreadNotice unread={unread} wide={false} />
          {assignedSection}
          {favoritesSection}
        </div>
      )}
    </div>
  );
}
