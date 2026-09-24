import { useCallback, useEffect, useState } from 'react';
import KbRepository from '../api/kbRepository';
import { emitKbTreeEvent, subscribeKbTreeEvents } from './kbTreeEvents';
import type { KbWorkspace } from './types';

/**
 * useWorkspaceList は所属ワークスペースの一覧・作成・削除だけを扱う軽量な hook。
 *
 * widgets/kb-sidebar の useKbTree はスペース・ページの木まで抱える重い hook なので、
 * ヘッダーのようにワークスペースの出入りだけが要る場所ではこちらを使う。
 *
 * 作成・削除は kbTreeEvents で他インスタンスへ知らせ、他インスタンス（KbFrame の
 * useKbTree・他画面の useWorkspaceList）からの通知も購読する。SecondaryPanel が
 * モバイル用/デスクトップ用の DOM を常に両方マウントするため、同じ画面内でも
 * ワークスペース一覧を持つインスタンスは複数存在し、片方の変更を他方が自動では知れない。
 */
export function useWorkspaceList() {
  const [workspaces, setWorkspaces] = useState<KbWorkspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    KbRepository.fetchWorkspaces()
      .then((list) => setWorkspaces(list))
      .catch(() => setError('ワークスペースを読み込めませんでした'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    return subscribeKbTreeEvents((event) => {
      if (event.type === 'workspace-created') {
        setWorkspaces((prev) => (prev.some((w) => w.slug === event.workspace.slug) ? prev : [...prev, event.workspace]));
        return;
      }
      if (event.type === 'workspace-deleted') {
        setWorkspaces((prev) => prev.filter((w) => w.slug !== event.workspaceSlug));
      }
    });
  }, []);

  const createWorkspace = useCallback(async (input: { name: string }): Promise<KbWorkspace> => {
    const workspace = await KbRepository.createWorkspace(input);
    setWorkspaces((prev) => [...prev, workspace]);
    emitKbTreeEvent({ type: 'workspace-created', workspace });
    return workspace;
  }, []);

  const deleteWorkspace = useCallback(async (slug: string): Promise<void> => {
    await KbRepository.deleteWorkspace(slug);
    setWorkspaces((prev) => prev.filter((w) => w.slug !== slug));
    emitKbTreeEvent({ type: 'workspace-deleted', workspaceSlug: slug });
  }, []);

  return { workspaces, loading, error, retry: load, createWorkspace, deleteWorkspace };
}
