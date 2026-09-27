import { useOutletContext } from 'react-router-dom';
import type { KbWorkspace } from '@/entities/kb';

/** 親ルート KbWorkspaceAdminLayout が、メンバーと招待の画面へ渡すもの。 */
export interface KbWorkspaceAdminOutlet {
  workspaceSlug: string;
  /** 自分が admin のワークスペース（親ルートが admin だと確かめてから子を描く）。 */
  workspace: KbWorkspace;
  /** ワークスペースを消す。一覧は親ルートが持つので、子で一覧を取り直さない。 */
  deleteWorkspace: (slug: string) => Promise<void>;
}

/** メンバーと招待の画面が、親ルートの確かめたワークスペースを受け取る。 */
export function useKbWorkspaceAdminOutlet(): KbWorkspaceAdminOutlet {
  return useOutletContext<KbWorkspaceAdminOutlet>();
}
