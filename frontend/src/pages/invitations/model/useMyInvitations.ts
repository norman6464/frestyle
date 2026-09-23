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

const EMPTY: MyInvitationsState = { invitations: [], loading: false, error: null, busyId: null };

/** useMyInvitations は自分宛の招待の一覧と、承諾・辞退。書き込みの後は一覧を引き直す。 */
export function useMyInvitations() {
  const [state, setState] = useState<MyInvitationsState>(EMPTY);
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
      setState({ ...EMPTY, error: status === 403 && serverCode === 'email_not_verified' ? 'notVerified' : 'unknown' });
    }
  }, []);

  useEffect(() => {
    void load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  const mutate = useCallback(
    async <T,>(busyId: string, run: () => Promise<T>): Promise<T> => {
      setState((prev) => ({ ...prev, busyId }));
      try {
        return await run();
      } finally {
        setState((prev) => ({ ...prev, busyId: null }));
      }
    },
    [],
  );

  /** 承諾する。成功したら入った先（workspaceSlug）を返す。一覧は呼び出し側が遷移するので引き直さない。 */
  const accept = useCallback(
    (invitationId: string): Promise<KbAcceptedInvitation> =>
      mutate(invitationId, () => KbRepository.acceptInvitation(invitationId)),
    [mutate],
  );

  const decline = useCallback(
    async (invitationId: string): Promise<void> => {
      await mutate(invitationId, () => KbRepository.declineInvitation(invitationId));
      await load();
    },
    [mutate, load],
  );

  return { ...state, retry: load, accept, decline };
}
