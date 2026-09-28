import { useMemo } from 'react';
import { Outlet, useMatch, useParams } from 'react-router-dom';
import { useWorkspaceList } from '@/entities/kb';
import KbWorkspaceTabs from './KbWorkspaceTabs';
import { ErrorNotice, Loading } from '@/shared/ui';
import { useKbFrameLocation } from '../model/kbFrameLocation';
import type { KbWorkspaceAdminOutlet } from '../model/kbWorkspaceAdminOutlet';
import KbAdminOnlyNotice from './KbAdminOnlyNotice';

/**
 * KbWorkspaceAdminLayout はワークスペースの管理（メンバー・招待）の 2 画面に共通の親ルート。
 *
 * URL のワークスペースを所属の一覧から引き、admin かどうかをここ 1 か所で確かめる。admin で
 * なければ（所属していなければ）どちらの画面でも同じ案内を出し、画面ごとの API は呼ばない。
 * 見出しとタブもここで描き、子の画面はタブの下の中身だけを描く。
 *
 * 画面を開けるかは backend も API ごとに確かめる（ここでの判定は表示のため）。セッションの途中で
 * 役割が変わったときは、子の画面が API の拒否を受けて KbAdminOnlyNotice を出す。
 */
export default function KbWorkspaceAdminLayout() {
  const { workspaceSlug } = useParams<{ workspaceSlug: string }>();
  const { workspaces, loading, error, retry, deleteWorkspace } = useWorkspaceList();
  const onInvitations = useMatch('/kb/:workspaceSlug/invitations') !== null;

  // ナレッジの枠（文脈バーのワークスペース側）の中に出す。スペースを持たない画面なので
  // 左の列（ページの木）は出さない。
  useKbFrameLocation({ workspaceSlug, showPagePanel: false });

  const workspace = workspaces.find((w) => w.slug === workspaceSlug) ?? null;
  const outlet = useMemo<KbWorkspaceAdminOutlet | null>(
    () => (workspaceSlug && workspace?.canManage ? { workspaceSlug, workspace, deleteWorkspace } : null),
    [workspaceSlug, workspace, deleteWorkspace],
  );

  let content;
  if (loading) {
    content = <Loading className="min-h-56" />;
  } else if (error) {
    content = (
      <div className="px-4 py-10 sm:px-6">
        <ErrorNotice message={error} onRetry={retry} className="mx-auto max-w-md" />
      </div>
    );
  } else if (!outlet) {
    content = <KbAdminOnlyNotice />;
  } else {
    content = (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:pt-12">
        <KbWorkspaceTabs
          workspaceSlug={outlet.workspaceSlug}
          workspaceName={outlet.workspace.name}
          active={onInvitations ? 'invitations' : 'members'}
        />
        <Outlet context={outlet} />
      </div>
    );
  }

  return <div className="min-h-0 flex-1 overflow-y-auto">{content}</div>;
}
