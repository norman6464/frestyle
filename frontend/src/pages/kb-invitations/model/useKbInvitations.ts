import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import {
  workspaceInvitationsQuery,
  type Invitation,
  type InviteByEmailInput,
  type IssuedInvitation,
  WorkspaceRepository,
  workspaceKeys,
} from '@/entities/workspace';

export interface KbInvitationsState {
  invitations: Invitation[];
  loading: boolean;
  /** 失敗の理由。'forbidden' は admin でない（メンバー一覧と同じ判定なので画面ごと出し分ける）。 */
  error: 'forbidden' | 'unknown' | null;
  /** いま再送・取消が飛んでいる招待の id。行ごとの操作を閉じるのに使う。 */
  busyId: string | null;
}

const NO_INVITATIONS: Invitation[] = [];

/**
 * useKbInvitations は招待の画面の一覧取得と、発行・再送・取消をまとめる。
 *
 * 一覧は共有の問い合わせ（workspaceInvitationsQuery）から読む。書き込みはどれも**成功した後に一覧を
 * 丸ごと取り直す**（取り直しを待ってから返す。useKbAdminMembers と同じ）。発行は同じ宛先の未決を
 * 再送に変える（新しい行にならない）ので、差分をこちらで組み立てるより取り直す方が確実。
 * 発行・再送は応答の token（この 1 回しか返らない）をそのまま返す — 画面がリンクにして相手へ渡す。
 */
export function useKbInvitations(workspaceSlug: string | undefined) {
  const queryClient = useQueryClient();
  const active = workspaceSlug !== undefined;
  const result = useQuery({ ...workspaceInvitationsQuery(workspaceSlug ?? ''), enabled: active });
  // 取り直しが 403・404 になったら（admin でなくなった）、持っている一覧も出さずに forbidden にする。
  const { data, loading, failed, lostAccess } = queryShownState(result, active);
  // 処理中の招待は、どのワークスペースで押したかと組で持つ（移った先の行を閉じない）。
  const [busy, setBusy] = useState<{ workspaceSlug: string; id: string | null } | null>(null);

  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  /** mutate は 1 回の書き込みを行い、成功したら一覧を取り直す。失敗は投げる（知らせは呼び出し側）。 */
  const mutate = useCallback(
    async <T,>(busyId: string | null, run: (slug: string) => Promise<T>): Promise<T> => {
      if (!workspaceSlug) throw new Error('workspace is not selected');
      const slug = workspaceSlug;
      setBusy({ workspaceSlug: slug, id: busyId });
      const runAndRefresh = async () => {
        const written = await run(slug);
        await queryClient.invalidateQueries({ queryKey: workspaceKeys.invitations(slug) });
        return written;
      };
      return runAndRefresh().finally(() =>
        setBusy((prev) => (prev?.workspaceSlug === slug && prev.id === busyId ? null : prev)),
      );
    },
    [workspaceSlug, queryClient],
  );

  const invite = useCallback(
    (input: InviteByEmailInput): Promise<IssuedInvitation> =>
      mutate(null, (slug) => WorkspaceRepository.inviteByEmail(slug, input)),
    [mutate],
  );

  const resend = useCallback(
    (invitationId: string): Promise<IssuedInvitation> =>
      mutate(invitationId, (slug) => WorkspaceRepository.resendInvitation(slug, invitationId)),
    [mutate],
  );

  const revoke = useCallback(
    (invitationId: string): Promise<void> =>
      mutate(invitationId, (slug) => WorkspaceRepository.revokeInvitation(slug, invitationId)),
    [mutate],
  );

  const state: KbInvitationsState = {
    invitations: data ?? NO_INVITATIONS,
    loading,
    error: lostAccess ? 'forbidden' : failed ? 'unknown' : null,
    busyId: busy !== null && busy.workspaceSlug === workspaceSlug ? busy.id : null,
  };
  return { ...state, retry, invite, resend, revoke };
}
