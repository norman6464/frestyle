import type { Project } from '@/entities/project';
import {
  firstAcrossLists,
  locateInList,
  type AcrossListsResolution,
  type LocatedListState,
  type LocationState,
  type OwnedListState,
} from '@/shared/lib/acrossLists';

/** 1 つのワークスペースのプロジェクトの一覧の、今の取り具合。 */
export type ProjectListState = OwnedListState<Project>;

/**
 * resolveEntryProject は素の /backlog（プロジェクト未指定）で最初に開くプロジェクトを決める。
 * 所属する最初のワークスペース → 最初のプロジェクト（配列の順序=key 順）。前のワークスペースの
 * 一覧がそろうまでは決めない。
 */
export function resolveEntryProject(lists: ProjectListState[]): AcrossListsResolution<Project> {
  return firstAcrossLists(lists);
}

/**
 * locateBacklogProject は projectId のプロジェクトを決める。どのワークスペースかは所在の口
 * （/projects/:projectId、location.owner は slug）で引き、プロジェクトそのものはそのワークスペースの
 * 一覧から読む（判断は shared/lib/acrossLists の locateInList。スペースの解決と同じ）。
 */
export function locateBacklogProject(
  projectId: string,
  location: LocationState,
  list: LocatedListState<Project>,
): AcrossListsResolution<Project> {
  return locateInList(location, list, (project) => project.id === projectId);
}
