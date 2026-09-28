import { useQuery } from '@tanstack/react-query';
import { workspacesQuery, type Workspace } from '@/entities/workspace';
import { toHomeResource, type HomeResource } from './homeResource';

const EMPTY: Workspace[] = [];

/**
 * 所属するワークスペース。所属 0 件（初回ホーム）の判定、最近のページの「ワークスペース名」
 * （応答には slug しか無い）、お気に入りの範囲の選択に使う。左の列・ヘッダーと同じ一覧を使う。
 */
export function useHomeWorkspaces(): HomeResource<Workspace[]> {
  return toHomeResource(useQuery(workspacesQuery()), EMPTY);
}
