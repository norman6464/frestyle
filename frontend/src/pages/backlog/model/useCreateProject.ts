import { useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { ProjectRepository, projectListQuery, type Project } from '@/entities/project';

/**
 * useCreateProject はワークスペースにプロジェクトを作る。作ったら共有のプロジェクトの一覧へ足す。
 * 作った直後にそのプロジェクトのバックログへ移るので、一覧へ足しておかないと、移った先の解決
 * （useBacklogProject）が一覧から見つけられず「見つからない」を出しうる。失敗は投げる。
 */
export function useCreateProject(workspaceSlug: string | undefined) {
  const queryClient = useQueryClient();
  return useCallback(
    async (input: { name: string }): Promise<Project> => {
      if (!workspaceSlug) throw new Error('workspace is not selected');
      const created = await ProjectRepository.createProject(workspaceSlug, input);
      await reflectWrite(queryClient, projectListQuery(workspaceSlug).queryKey, (prev) =>
        prev.some((p) => p.id === created.id) ? prev : [...prev, created],
      );
      return created;
    },
    [workspaceSlug, queryClient],
  );
}
