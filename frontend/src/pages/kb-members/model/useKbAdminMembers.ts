import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { getApiError } from '@/shared/lib/classifyApiError';
import {
  KbRepository,
  kbAdminMembersQuery,
  kbKeys,
  type KbAdminWorkspaceMember,
  type KbGrantRole,
} from '@/entities/kb';

export interface KbAdminMembersState {
  members: KbAdminWorkspaceMember[];
  loading: boolean;
  /** 失敗の理由。null なら失敗していない。'forbidden' は admin でない（画面ごと出し分ける）。 */
  error: 'forbidden' | 'unknown' | null;
  /** いま処理中の相手の userId。行ごとの操作ボタンを閉じるのに使う（useKbComments の saving と同じ思想）。 */
  busyUserId: number | null;
}

const NO_MEMBERS: KbAdminWorkspaceMember[] = [];

/**
 * useKbAdminMembers はメンバー管理画面（段 7）の一覧取得と、役割変更・停止・復帰・削除の
 * 書き込みをまとめる。
 *
 * 一覧は共有の問い合わせ（kbAdminMembersQuery）から読む。ワークスペースごとの鍵なので、別の
 * ワークスペースの管理画面へ移ったら前の一覧は出ない。
 *
 * 書き込みはすべて**楽観更新をせず、成功した後に一覧を丸ごと取り直す**（取り直しを待ってから返す）。
 * 停止・復帰・役割変更・削除のどれも「最後の admin」の可否が他の行にも影響しうる操作の余地があり
 * （例えば admin を 1 人に減らした直後は他の行の削除ボタンの意味が変わる）、
 * 差分をこちらで組み立てるより取り直す方が確実。ワークスペースの人の一覧（名指しの候補）も
 * 古いものにする。
 */
export function useKbAdminMembers(workspaceSlug: string | undefined) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined;
  const result = useQuery({ ...kbAdminMembersQuery(workspaceSlug ?? ''), enabled: active });
  const { loading, failed } = queryShownState(result, active);
  // 処理中の相手は、どのワークスペースで押したかと組で持つ（移った先の行を閉じない）。
  const [busy, setBusy] = useState<{ workspaceSlug: string; userId: number } | null>(null);

  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  /** mutate は 1 回の書き込みを行い、成功したら一覧を取り直す。失敗は投げる（知らせは呼び出し側）。 */
  const mutate = useCallback(
    async (userId: number, run: (slug: string) => Promise<void>) => {
      if (!workspaceSlug) return;
      const slug = workspaceSlug;
      setBusy({ workspaceSlug: slug, userId });
      try {
        await run(slug);
        void queryClient.invalidateQueries({ queryKey: kbKeys.members(slug) });
        await queryClient.invalidateQueries({ queryKey: kbKeys.adminMembers(slug) });
      } finally {
        setBusy((prev) => (prev?.workspaceSlug === slug && prev.userId === userId ? null : prev));
      }
    },
    [workspaceSlug, queryClient],
  );

  const changeRole = useCallback(
    (principalId: string, userId: number, role: KbGrantRole | null) =>
      mutate(userId, (slug) =>
        role === null
          ? KbRepository.revokeWorkspaceRole(slug, principalId)
          : KbRepository.grantWorkspaceRole(slug, principalId, role),
      ),
    [mutate],
  );

  const suspend = useCallback(
    (userId: number) => mutate(userId, (slug) => KbRepository.suspendMember(slug, userId)),
    [mutate],
  );

  const restore = useCallback(
    (userId: number) => mutate(userId, (slug) => KbRepository.restoreMember(slug, userId)),
    [mutate],
  );

  const remove = useCallback(
    (userId: number) => mutate(userId, (slug) => KbRepository.removeMember(slug, userId)),
    [mutate],
  );

  const state: KbAdminMembersState = {
    members: active ? (result.data ?? NO_MEMBERS) : NO_MEMBERS,
    loading,
    error: failed ? (getApiError(result.error).status === 403 ? 'forbidden' : 'unknown') : null,
    busyUserId: busy !== null && busy.workspaceSlug === workspaceSlug ? busy.userId : null,
  };
  return { ...state, retry, changeRole, suspend, restore, remove };
}
