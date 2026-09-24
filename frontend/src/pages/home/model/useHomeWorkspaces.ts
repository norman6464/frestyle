import { KbRepository, type KbWorkspace } from '@/entities/kb';
import { useHomeResource } from './useHomeResource';

const EMPTY: KbWorkspace[] = [];

/**
 * 所属するワークスペース。所属 0 件（初回ホーム）の判定、最近のページの「ワークスペース名」
 * （応答には slug しか無い）、お気に入りの範囲の選択に使う。
 */
export function useHomeWorkspaces() {
  return useHomeResource('workspaces', () => KbRepository.fetchWorkspaces(), EMPTY);
}
