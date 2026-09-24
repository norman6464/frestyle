import { useCallback, useEffect, useRef, useState } from 'react';
import { KbRepository, type KbAcceptedInvitation, type KbInvitation } from '@/entities/kb';
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

/**
 * 最初の状態は「読み込み中」。読み込み前を「0 件」で始めると、一瞬「新しい招待はありません」が
 * 出てから一覧に替わる（届いているのに無いと読める）。
 */
const INITIAL: MyInvitationsState = { invitations: [], loading: true, error: null, busyId: null };

/**
 * useMyInvitations は自分宛の招待の一覧と、承諾・辞退。
 *
 * 承諾したものは手元の一覧から外す（参加完了のカードに替わり、その場に残す必要が無い）。
 * 辞退したものも外す。どちらも失敗したら投げ返す（理由はカードの位置に出す）。
 */
export function useMyInvitations() {
  const [state, setState] = useState<MyInvitationsState>(INITIAL);
  const seq = useRef(0);

  const load = useCallback(async () => {
    const request = ++seq.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const invitations = await KbRepository.fetchMyInvitations();
      if (seq.current !== request) return;
      setState({ invitations, loading: false, error: null, busyId: null });
    } catch (cause) {
      if (seq.current !== request) return;
      const { status, serverCode } = getApiError(cause);
      setState({
        invitations: [],
        loading: false,
        busyId: null,
        error: status === 403 && serverCode === 'email_not_verified' ? 'notVerified' : 'unknown',
      });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  const mutate = useCallback(async <T,>(busyId: string, run: () => Promise<T>): Promise<T> => {
    setState((prev) => ({ ...prev, busyId }));
    try {
      return await run();
    } finally {
      setState((prev) => ({ ...prev, busyId: null }));
    }
  }, []);

  const drop = (invitationId: string) =>
    setState((prev) => ({ ...prev, invitations: prev.invitations.filter((inv) => inv.id !== invitationId) }));

  /** 承諾する。成功したら入った先を返し、一覧から外す。 */
  const accept = useCallback(
    async (invitationId: string): Promise<KbAcceptedInvitation> => {
      const accepted = await mutate(invitationId, () => KbRepository.acceptInvitation(invitationId));
      drop(invitationId);
      return accepted;
    },
    [mutate],
  );

  /** 辞退する。成功したら一覧から外す。 */
  const decline = useCallback(
    async (invitationId: string): Promise<void> => {
      await mutate(invitationId, () => KbRepository.declineInvitation(invitationId));
      drop(invitationId);
    },
    [mutate],
  );

  return { ...state, retry: load, accept, decline };
}
