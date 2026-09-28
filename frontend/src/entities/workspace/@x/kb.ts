/*
 * entities/kb に見せるもの（FSD の @x）。ナレッジのスペース・ページの権限は、ワークスペースと同じ
 * 役割の言葉で表す。入口の解決（最初に開くスペース）は所属の一覧から導く。
 */
export type { GrantRole, Workspace } from '../model/types';
export { workspacesQuery } from '../api/workspaceQueries';
