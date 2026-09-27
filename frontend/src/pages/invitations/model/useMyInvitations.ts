import { useCallback, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reflectWrite } from '@/shared/api/queryCache';
import { queryShownState } from '@/shared/api/queryState';
import { KbRepository, kbKeys, kbMyInvitationsQuery, type KbAcceptedInvitation, type KbInvitation } from '@/entities/kb';
import { getApiError } from '@/shared/lib/classifyApiError';

export interface MyInvitationsState {
  invitations: KbInvitation[];
  loading: boolean;
  /**
   * 失敗の理由。'notVerified' は確認済みの email が無いアカウント（403 email_not_verified）—
   * 招待は email 宛に届くので、突き合わせる材料が無い。
   */
  error: 'notVerified' | 'unknown' | null;
  /** いま承諾・辞退が飛んでいる招待の id。 */
  busyId: string | null;
}

const NO_INVITATIONS: KbInvitation[] = [];

/**
 * useMyInvitations は自分宛の招待の一覧と、承諾・辞退。
 *
 * 一覧は共有の問い合わせ（kbMyInvitationsQuery）から読む。最初は「読み込み中」から始まる
 * （読み込み前を「0 件」で始めると、一瞬「新しい招待はありません」が出てから一覧に替わり、
 * 届いているのに無いと読める）。
 *
 * 承諾したものは一覧から外す（参加完了のカードに替わり、その場に残す必要が無い）。
 * 辞退したものも外す。どちらも失敗したら投げ返す（理由はカードの位置に出す）。
 *
 * 承諾すると所属が変わる（ワークスペースが増える・見られるスペースが増える）。共有の所属の
 * 一覧とその中のものを古いものにして、次に見る場所（左の列・ホーム）で取り直させる。
 */
export function useMyInvitations() {
  const queryClient = useQueryClient();
  const result = useQuery(kbMyInvitationsQuery());
  const { loading, failed } = queryShownState(result);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { refetch } = result;
  const retry = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const settle = useCallback(
    async <T,>(invitationId: string, run: () => Promise<T>): Promise<T> => {
      setBusyId(invitationId);
      try {
        const settled = await run();
        await reflectWrite(queryClient, kbMyInvitationsQuery().queryKey, (prev) =>
          prev.filter((inv) => inv.id !== invitationId),
        );
        return settled;
      } finally {
        setBusyId(null);
      }
    },
    [queryClient],
  );

  /** 承諾する。成功したら入った先を返し、一覧から外す。 */
  const accept = useCallback(
    async (invitationId: string): Promise<KbAcceptedInvitation> => {
      const accepted = await settle(invitationId, () => KbRepository.acceptInvitation(invitationId));
      void queryClient.invalidateQueries({ queryKey: kbKeys.workspaces() });
      return accepted;
    },
    [settle, queryClient],
  );

  /** 辞退する。成功したら一覧から外す。 */
  const decline = useCallback(
    async (invitationId: string): Promise<void> => {
      await settle(invitationId, () => KbRepository.declineInvitation(invitationId));
    },
    [settle],
  );

  let error: MyInvitationsState['error'] = null;
  if (failed) {
    const { status, serverCode } = getApiError(result.error);
    error = status === 403 && serverCode === 'email_not_verified' ? 'notVerified' : 'unknown';
  }
  const state: MyInvitationsState = {
    invitations: result.data ?? NO_INVITATIONS,
    loading,
    error,
    busyId,
  };
  return { ...state, retry, accept, decline };
}
