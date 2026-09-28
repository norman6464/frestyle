import { useEffect, Suspense } from 'react';
import { Routes, Route, useLocation, Navigate, useParams } from 'react-router-dom';
import AuthInitializer from './providers/AuthInitializer';
import Protected from './providers/Protected';
import ErrorBoundary from './providers/ErrorBoundary';
import { Loading } from '@/shared/ui';
import { ToastProvider } from './providers/ToastProvider';
import { useToast } from '@/shared/lib/hooks/useToast';
import ToastContainer from '@/app/providers/ToastContainer';
import { lazyWithReload, clearLazyReloadFlags } from '@/shared/lib/lazyWithReload';
import { hasAuthHint } from '@/shared/lib/authHint';

/* v8 ignore start -- 以下はコード分割のためのルート表。各 `() => import(...)` は
   中身を持たない読み込み用の関数で、埋めるには全ページを描画するしかなく指標として
   意味を持たない。実ロジック（NavigationToast / AppRoutes）は計測対象のまま残す。 */
// 認証不要ページ
const LoginPage = lazyWithReload(() => import('@/pages/login').then((m) => ({ default: m.LoginPage })), 'LoginPage');
const SignupPage = lazyWithReload(() => import('@/pages/signup').then((m) => ({ default: m.SignupPage })), 'SignupPage');
const LoginCallback = lazyWithReload(() => import('@/pages/login-callback').then((m) => ({ default: m.LoginCallback })), 'LoginCallback');
const PasswordResetPage = lazyWithReload(() => import('@/pages/password-reset').then((m) => ({ default: m.PasswordResetPage })), 'PasswordResetPage');
const InvitePage = lazyWithReload(() => import('@/pages/invite').then((m) => ({ default: m.InvitePage })), 'InvitePage');

// 認証必要ページ
const HomePage = lazyWithReload(() => import('@/pages/home').then((m) => ({ default: m.HomePage })), 'HomePage');
const SettingsPage = lazyWithReload(() => import('@/pages/settings').then((m) => ({ default: m.SettingsPage })), 'SettingsPage');
// ログイン後の親（枠とキャッシュの置き場）。最初に読む塊に入れない（app/layouts/AuthenticatedLayout）。
// ログインの確認と並べて読み始める（AuthenticatedRoute）。
const loadAuthenticatedLayout = () => import('./layouts/AuthenticatedLayout');
const AuthenticatedLayout = lazyWithReload(loadAuthenticatedLayout, 'AuthenticatedLayout');
const KbPage = lazyWithReload(() => import('@/pages/kb').then((m) => ({ default: m.KbPage })), 'KbPage');
const KbFrameLayout = lazyWithReload(
  () => import('@/widgets/kb-frame').then((m) => ({ default: m.KbFrameLayout })),
  'KbFrameLayout',
);
const KbWorkspaceAdminLayout = lazyWithReload(
  () => import('@/widgets/kb-frame').then((m) => ({ default: m.KbWorkspaceAdminLayout })),
  'KbWorkspaceAdminLayout',
);
const KbSpaceLayout = lazyWithReload(
  () => import('@/widgets/kb-frame').then((m) => ({ default: m.KbSpaceLayout })),
  'KbSpaceLayout',
);
const AssignedPage = lazyWithReload(
  () => import('@/pages/assigned').then((m) => ({ default: m.AssignedPage })),
  'AssignedPage',
);
const BacklogLayout = lazyWithReload(
  () => import('@/pages/backlog').then((m) => ({ default: m.BacklogLayout })),
  'BacklogLayout',
);
const BacklogTicketsPage = lazyWithReload(
  () => import('@/pages/backlog').then((m) => ({ default: m.BacklogTicketsPage })),
  'BacklogTicketsPage',
);
const BacklogSettingsPage = lazyWithReload(
  () => import('@/pages/backlog').then((m) => ({ default: m.BacklogSettingsPage })),
  'BacklogSettingsPage',
);
const TicketPage = lazyWithReload(
  () => import('@/pages/backlog').then((m) => ({ default: m.TicketPage })),
  'TicketPage',
);
const InvitationsPage = lazyWithReload(
  () => import('@/pages/invitations').then((m) => ({ default: m.InvitationsPage })),
  'InvitationsPage',
);
const KbMembersPage = lazyWithReload(
  () => import('@/pages/kb-members').then((m) => ({ default: m.KbMembersPage })),
  'KbMembersPage',
);
const KbInvitationsPage = lazyWithReload(
  () => import('@/pages/kb-invitations').then((m) => ({ default: m.KbInvitationsPage })),
  'KbInvitationsPage',
);
const KbSpaceOverviewPage = lazyWithReload(
  () => import('@/pages/kb-space-overview').then((m) => ({ default: m.KbSpaceOverviewPage })),
  'KbSpaceOverviewPage',
);
const KbSpaceAllPagesPage = lazyWithReload(
  () => import('@/pages/kb-space-pages').then((m) => ({ default: m.KbSpaceAllPagesPage })),
  'KbSpaceAllPagesPage',
);
const KbSpaceFavoritesPage = lazyWithReload(
  () => import('@/pages/kb-space-favorites').then((m) => ({ default: m.KbSpaceFavoritesPage })),
  'KbSpaceFavoritesPage',
);
const KbSpaceMembersPage = lazyWithReload(
  () => import('@/pages/kb-space-members').then((m) => ({ default: m.KbSpaceMembersPage })),
  'KbSpaceMembersPage',
);
const NotificationPage = lazyWithReload(() => import('@/pages/notifications').then((m) => ({ default: m.NotificationPage })), 'NotificationPage');
// inkwell プリミティブの見た目確認用カタログ（認証不要・削除可）。
const InkwellShowcasePage = lazyWithReload(() => import('@/pages/inkwell-showcase').then((m) => ({ default: m.InkwellShowcasePage })), 'InkwellShowcasePage');
const NotFoundPage = lazyWithReload(() => import('@/pages/not-found').then((m) => ({ default: m.NotFoundPage })), 'NotFoundPage');
/* v8 ignore stop */

function NavigationToast() {
  const location = useLocation();
  const { showToast } = useToast();

  useEffect(() => {
    const toast = (location.state as { toast?: string })?.toast;
    if (toast) {
      showToast('success', toast);
      window.history.replaceState({}, '');
    }
    // ナビゲーション成功 = 直前の lazy reload で復旧した。次回また chunk が
    // 失敗したら再度 reload を許可するため、フラグをクリアしておく。
    clearLazyReloadFlags();
  }, [location, showToast]);

  return null;
}

/**
 * ログインが要る画面の親。ログインの確認（AuthInitializer）を待つ間に、ログイン後の枠の塊を
 * 読み始める。確認が済んでから読むと、確認 → 枠の塊 → 画面の塊 と順に待つことになる。
 * ログインの手がかり（cookie）が無ければ読まない（ほぼログイン画面へ移るので、使わない塊を読ませない）。
 */
function AuthenticatedRoute() {
  useEffect(() => {
    if (!hasAuthHint()) return;
    loadAuthenticatedLayout().catch(() => {
      // 読めなければ、描くときに lazyWithReload が扱う（読み直し）。
    });
  }, []);
  return (
    <AuthInitializer>
      <Protected>
        <AuthenticatedLayout />
      </Protected>
    </AuthInitializer>
  );
}

// LegacyKbPageRedirect は旧 /kb/:slug/pages/:pageId を /kb/:pageId へ写す。
// slug は URL から消えた（テナントはページ ID から解決する）ので捨ててよい。
function LegacyKbPageRedirect() {
  const { pageId } = useParams<{ pageId: string }>();
  return <Navigate to={`/kb/${pageId ?? ''}`} replace />;
}

export default function App() {
  return (
    <ErrorBoundary>
    <ToastProvider>
    <Suspense fallback={<Loading fullscreen message="読み込み中…" />}>
    <Routes>
      {/* 誰でもアクセス可能 */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/login/callback" element={<LoginCallback />} />
      <Route path="/password-reset" element={<PasswordResetPage />} />
      {/* 招待リンク（/invite#t=…）の案内。ログイン前に見られる。参加はログイン後の /invitations で行う。 */}
      <Route path="/invite" element={<InvitePage />} />
      {/* inkwell UI カタログ（見た目確認用・認証不要）。開発環境だけで開く。本番でログイン無しに
          開ける見本ページを置かない（製品と違う配色の画面が公開の URL で見えてしまう）。 */}
      {import.meta.env.DEV && <Route path="/dev/inkwell" element={<InkwellShowcasePage />} />}

      {/* 認証が必要（AppShell レイアウト内） */}
      <Route element={<AuthenticatedRoute />}>
        {/* ホーム（ログイン後の入口）。 */}
        <Route path="/" element={<HomePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        {/* 旧 /profile/me は /settings に統合（後方互換のため redirect 相当として SettingsPage を出す） */}
        <Route path="/profile/me" element={<SettingsPage />} />
        {/*
          ナレッジ（workspaces → spaces → pages の木）。テナントは URL に出さない。
          ページの URL は /kb/{pageId}、ページ未選択の入口は素の /kb（続きのページへ
          resolveEntryPageId が即座に移す。空振りだけ「まだページがありません」を出す）。

          ナレッジの画面は、文脈バーと左の列（ページの木）の枠を共通の親ルート（KbFrameLayout）が
          1 回だけ描き、本文だけを差し替える。画面を移っても枠を作り直さない（木を取り直さず、
          開いていたフォルダも閉じない）。今いるスペースは各画面が枠へ知らせる。
        */}
        <Route element={<KbFrameLayout />}>
          <Route path="/kb" element={<KbPage />} />
          <Route path="/kb/:pageId" element={<KbPage />} />
          {/* ワークスペース単位の管理。役割変更・停止 / 復帰・削除（members）と、email での招待
              （invitations）。見出しは共通で、タブで行き来する。ワークスペース自体の設定なので
              /kb/{pageId} と違い workspaceSlug を URL に出す。ワークスペースの引き当て・admin の
              判定・見出しとタブは親ルート KbWorkspaceAdminLayout が 1 か所で持つ。 */}
          <Route element={<KbWorkspaceAdminLayout />}>
            <Route path="/kb/:workspaceSlug/members" element={<KbMembersPage />} />
            <Route path="/kb/:workspaceSlug/invitations" element={<KbInvitationsPage />} />
          </Route>
          {/*
            スペース単位の 4 画面。「workspaceSlug を URL に持たず spaceId だけで解決する」流儀。/kb/spaces はスペース未選択の入口（自分がアクセス
            できる最初のスペースへ移す）を兼ねる。スペースの解決と、読み込み中・見つからない・
            読み込めない・スペースが無い、は親ルート KbSpaceLayout が 1 か所で持つ。
          */}
          <Route element={<KbSpaceLayout />}>
            <Route path="/kb/spaces" element={<KbSpaceOverviewPage />} />
            <Route path="/kb/spaces/:spaceId" element={<KbSpaceOverviewPage />} />
            <Route path="/kb/spaces/:spaceId/pages" element={<KbSpaceAllPagesPage />} />
            <Route path="/kb/spaces/:spaceId/favorites" element={<KbSpaceFavoritesPage />} />
            <Route path="/kb/spaces/:spaceId/members" element={<KbSpaceMembersPage />} />
          </Route>
        </Route>
        {/* 旧 URL の受け皿。ワークスペース単体（/kb/:workspaceSlug）の形は新しい
            /kb/:pageId と区別できないため対応しない。ページ付きの旧 URL
            （/kb/:slug/pages/:pageId）だけこの受け皿で写す。 */}
        <Route path="/kb/:workspaceSlug/pages/:pageId" element={<LegacyKbPageRedirect />} />
        {/*
          バックログ（チケット）。URL は `/kb` の下に置かない — ナレッジとは別の製品で、
          入れ物（プロジェクト）もスペースとは無関係のため。/backlog はプロジェクト未選択の
          入口（最初に見つかったプロジェクトへ移す）、個票は /tickets/{ticketId}
          （kb の /kb/{pageId} と同じ、ワークスペースを URL に出さない解決の口）。
        */}
        {/* 自分の担当。プロジェクトを横断するので URL にプロジェクトを取らない。 */}
        <Route path="/assigned" element={<AssignedPage />} />
        {/* バックログの面は経路が持つ。戻る・進む・リンクの共有がそのまま効くようにするため、
            問い合わせ文字列（?tab=）ではなくパスの段に出す。プロジェクトの解決は共通の親ルート
            （BacklogLayout）が持ち、面を移っても解決し直さない。 */}
        <Route element={<BacklogLayout />}>
          <Route path="/backlog" element={<BacklogTicketsPage />} />
          <Route path="/backlog/:projectId" element={<BacklogTicketsPage />} />
          <Route path="/backlog/:projectId/archive" element={<BacklogTicketsPage archived />} />
          <Route path="/backlog/:projectId/settings" element={<BacklogSettingsPage />} />
        </Route>
        <Route path="/tickets/:ticketId" element={<TicketPage />} />
        <Route path="/notifications" element={<NotificationPage />} />
        {/* 自分宛の招待。通知の飛び先で、/invite からログインした後の戻り先。 */}
        <Route path="/invitations" element={<InvitationsPage />} />
      </Route>

      {/* どのルートにも一致しない URL の受け皿。
          認証ブロックの外に置く: 中に入れると未ログイン時に /login へ飛ばされ、
          タイポや古いリンクで来た訪問者に 404 を見せられない（公開サイトとして不適切）。 */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
    </Suspense>
    <NavigationToast />
    <ToastContainer />
    </ToastProvider>
    </ErrorBoundary>
  );
}

