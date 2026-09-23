import { useCallback, useEffect, useRef, useState } from 'react';
import { KbRepository, type KbInvitation, type KbInviteByEmailInput, type KbIssuedInvitation } from '@/entities/kb';
import { getApiError } from '@/shared/lib/classifyApiError';

export interface KbInvitationsState {
  invitations: KbInvitation[];
  loading: boolean;
  /** 失敗の理由。'forbidden' は admin でない（メンバー一覧と同じ判定なので画面ごと出し分ける）。 */
  error: 'forbidden' | 'unknown' | null;
  /** いま再送・取消が飛んでいる招待の id。行ごとの操作を閉じるのに使う。 */
  busyId: string | null;
}

const EMPTY: KbInvitationsState = { invitations: [], loading: false, error: null, busyId: null };

/**
 * useKbInvitations は招待の画面の一覧取得と、発行・再送・取消をまとめる。
 *
 * 書き込みはどれも**成功した後に一覧を丸ごと引き直す**（useKbAdminMembers と同じ）。発行は
 * 同じ宛先の未決を再送に変える（新しい行にならない）ので、差分をこちらで組み立てるより
 * 引き直す方が確実。発行・再送は応答の token（この 1 回しか返らない）をそのまま返す —
 * 画面がリンクにして相手へ渡す。
 */
export function useKbInvitations(workspaceSlug: string | undefined) {
  const [state, setState] = useState<KbInvitationsState>(EMPTY);
  const active = useRef<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(async (slug: string) => {
    const request = ++seq.current;
    setState((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const invitations = await KbRepository.fetchInvitations(slug);
      if (active.current !== slug || seq.current !== request) return;
      setState({ invitations, loading: false, error: null, busyId: null });
    } catch (cause) {
      if (active.current !== slug || seq.current !== request) return;
      const status = getApiError(cause).status;
      // 権限操作 API は拒否を 404 で揃える（実在を教えない）。admin でない人が開いたときの
      // 404 は「無い」ではなく「見せない」なので、メンバー一覧の 403 と同じ扱いにする。
      setState({ ...EMPTY, error: status === 403 || status === 404 ? 'forbidden' : 'unknown' });
    }
  }, []);

  useEffect(() => {
    active.current = workspaceSlug ?? null;
    if (!workspaceSlug) {
      seq.current += 1;
      setState(EMPTY);
      return;
    }
    void load(workspaceSlug);
  }, [workspaceSlug, load]);

  const retry = useCallback(() => {
    if (workspaceSlug) void load(workspaceSlug);
  }, [workspaceSlug, load]);

  /** mutate は 1 回の書き込みを行い、成功したら一覧を引き直す。失敗は投げる（知らせは呼び出し側）。 */
  const mutate = useCallback(
    async <T,>(busyId: string | null, run: (slug: string) => Promise<T>): Promise<T> => {
      const slug = active.current;
      if (!slug) throw new Error('workspace is not selected');
      setState((prev) => ({ ...prev, busyId }));
      try {
        const result = await run(slug);
        if (active.current === slug) await load(slug);
        return result;
      } finally {
        if (active.current === slug) setState((prev) => ({ ...prev, busyId: null }));
      }
    },
    [load],
  );

  const invite = useCallback(
    (input: KbInviteByEmailInput): Promise<KbIssuedInvitation> =>
      mutate(null, (slug) => KbRepository.inviteByEmail(slug, input)),
    [mutate],
  );

  const resend = useCallback(
    (invitationId: string): Promise<KbIssuedInvitation> =>
      mutate(invitationId, (slug) => KbRepository.resendInvitation(slug, invitationId)),
    [mutate],
  );

  const revoke = useCallback(
    (invitationId: string): Promise<void> =>
      mutate(invitationId, (slug) => KbRepository.revokeInvitation(slug, invitationId)),
    [mutate],
  );

  return { ...state, retry, invite, resend, revoke };
}
