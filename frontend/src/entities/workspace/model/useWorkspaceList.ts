import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { reflectWrite } from '@/shared/api/queryCache';
import WorkspaceRepository from '../api/workspaceRepository';
import { workspaceKeys, workspacesQuery } from '../api/workspaceQueries';
import type { Workspace } from './types';

const NO_WORKSPACES: Workspace[] = [];

/**
 * useWorkspaceList は所属ワークスペースの一覧・作成・削除だけを扱う軽量な hook。
 *
 * 一覧は共有の問い合わせ（workspacesQuery）から読む。左の列・管理の画面・ホームが同じ結果を
 * 使うので、1 回だけ取り、どこかで作った・消したワークスペースはほかの場所の一覧にもすぐ出る
 * （作成・削除は共有の一覧を reflectWrite で差し替える）。
 *
 * 削除したら、中のもの（ナレッジもチケットも）の控えを鍵ごと消す。ナレッジの画面に固有の後始末
 * （ワークスペースをまたぐ「最近のページ」・開いているページへの合図）は、ここではしない。
 * ワークスペースはナレッジより下の概念なので、組み合わせる側（ナレッジの枠）が kb の
 * forgetKbWorkspace をつなぐ。
 */
export function useWorkspaceList() {
  const queryClient = useQueryClient();
  const result = useQuery(workspacesQuery());

  const createWorkspace = useCallback(
    async (input: { name: string }): Promise<Workspace> => {
      const workspace = await WorkspaceRepository.createWorkspace(input);
      await reflectWrite(queryClient, workspacesQuery().queryKey, (prev) =>
        prev.some((w) => w.slug === workspace.slug) ? prev : [...prev, workspace],
      );
      return workspace;
    },
    [queryClient],
  );

  const deleteWorkspace = useCallback(
    async (slug: string): Promise<void> => {
      await WorkspaceRepository.deleteWorkspace(slug);
      await reflectWrite(queryClient, workspacesQuery().queryKey, (prev) => prev.filter((w) => w.slug !== slug));
      // 中のもの（スペースの一覧・チケットなど）はサーバーで一緒に消えている。控えにも残さない。
      queryClient.removeQueries({ queryKey: workspaceKeys.scope(slug) });
    },
    [queryClient],
  );

  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const view = queryShownState(result);
  return {
    workspaces: view.data ?? NO_WORKSPACES,
    loading: view.loading,
    error: view.failed ? 'ワークスペースを読み込めませんでした' : null,
    retry,
    createWorkspace,
    deleteWorkspace,
  };
}
