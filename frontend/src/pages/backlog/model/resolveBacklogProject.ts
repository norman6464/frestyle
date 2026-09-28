import type { Project } from '@/entities/project';
import { findAcrossLists, firstAcrossLists, type AcrossListsResolution, type OwnedListState } from '@/shared/lib/acrossLists';

export interface ResolvedBacklogProject {
  workspaceSlug: string;
  project: Project;
}

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
 * locateBacklogProject は projectId からワークスペースを引く。
 *
 * `/backlog/:projectId` は URL にワークスペースを出さない既存の規則を踏襲するが、projectId から
 * 直接ワークスペースを引く backend の口が無いので、所属ワークスペースのプロジェクトの一覧から
 * その ID を探す。ワークスペース数は実データで数個・プロジェクト一覧は軽い口なので、いまはこれで足りる。
 */
export function locateBacklogProject(projectId: string, lists: ProjectListState[]): AcrossListsResolution<Project> {
  return findAcrossLists(lists, (project) => project.id === projectId);
}
