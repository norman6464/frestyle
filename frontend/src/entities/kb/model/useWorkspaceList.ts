import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import KbRepository from '../api/kbRepository';
import { kbKeys, kbWorkspacesQuery } from '../api/kbQueries';
import { emitKbTreeEvent } from './kbTreeEvents';
import type { KbWorkspace } from './types';

const NO_WORKSPACES: KbWorkspace[] = [];

/**
 * useWorkspaceList は所属ワークスペースの一覧・作成・削除だけを扱う軽量な hook。
 *
 * 一覧は共有の問い合わせ（kbWorkspacesQuery）から読む。左の列（useKbTree）・管理の画面・
 * ホームが同じ結果を使うので、1 回だけ取り、どこかで作った・消したワークスペースは
 * 知らせを待たずにほかの場所の一覧にも出る（作成・削除は共有の一覧を setQueryData で差し替える）。
 *
 * 削除の知らせ（kbTreeEvents）はまだ出す。開いているページの画面が、ワークスペースが
 * 消えたことを知らせで受けて移るため（知らせは第4段の途中で退役させる）。
 */
export function useWorkspaceList() {
  const queryClient = useQueryClient();
  const result = useQuery(kbWorkspacesQuery());

  const createWorkspace = useCallback(
    async (input: { name: string }): Promise<KbWorkspace> => {
      const workspace = await KbRepository.createWorkspace(input);
      queryClient.setQueryData(kbWorkspacesQuery().queryKey, (prev) =>
        prev?.some((w) => w.slug === workspace.slug) ? prev : [...(prev ?? []), workspace],
      );
      return workspace;
    },
    [queryClient],
  );

  const deleteWorkspace = useCallback(
    async (slug: string): Promise<void> => {
      await KbRepository.deleteWorkspace(slug);
      queryClient.setQueryData(kbWorkspacesQuery().queryKey, (prev) => prev?.filter((w) => w.slug !== slug));
      // 中のもの（スペースの一覧など）はサーバーで一緒に消えている。控えにも残さない。
      queryClient.removeQueries({ queryKey: kbKeys.workspace(slug) });
      emitKbTreeEvent({ type: 'workspace-deleted', workspaceSlug: slug });
    },
    [queryClient],
  );

  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    workspaces: result.data ?? NO_WORKSPACES,
    // 失敗のあと取り直している間は読み込み中に戻す。一覧を持っているうちの取り直しの失敗は、
    // 持っている一覧を出し続ける（失敗の表示で隠さない）。
    loading: result.isPending || (result.isError && result.isFetching),
    error: result.data === undefined && result.isError && !result.isFetching ? 'ワークスペースを読み込めませんでした' : null,
    retry,
    createWorkspace,
    deleteWorkspace,
  };
}
