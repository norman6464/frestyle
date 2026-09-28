import { useOutletContext } from 'react-router-dom';
import type { Project } from '@/entities/project';

/** 親ルート BacklogLayout が解決して、バックログの面へ渡すもの。 */
export interface BacklogOutlet {
  workspaceSlug: string;
  project: Project;
}

/**
 * バックログの面（一覧・アーカイブ・設定）が、親ルートの解決したプロジェクトを受け取る。
 * 親ルートは解決できたときだけ子を描くので、ここで null は返らない。
 */
export function useBacklogOutlet(): BacklogOutlet {
  return useOutletContext<BacklogOutlet>();
}
