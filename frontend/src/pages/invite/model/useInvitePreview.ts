import { useEffect, useState } from 'react';
import { KbRepository, readInviteToken, type KbInvitationPreview } from '@/entities/kb';
import { hasAuthHint } from '@/shared/lib/authHint';

export type InvitePreviewState =
  | { status: 'loading' }
  | { status: 'pending'; preview: KbInvitationPreview }
  /** 無い・期限切れ・結果済み。理由は返らない（トークンを持っているだけの相手に教えない）。 */
  | { status: 'unavailable' }
  /** 通信が切れた等。招待が無いのではなく、確かめられていない状態。 */
  | { status: 'error' };

/**
 * useInvitePreview は招待リンク（/invite#t=<token>）を開いたときの案内を取る。
 *
 * トークンは URL のフラグメントから読んだら**すぐ URL から消す**（履歴・共有・スクリーンショットに
 * 残さない）。読んだ値は本文で POST /kb/invitations/preview に送る。ログインしているかは
 * 発行者の状態ではなく目印 Cookie（hasAuthHint）で見る — この画面は認証の外側にあり、
 * Redux の認証状態は初期化されていないため。
 */
export function useInvitePreview() {
  const [state, setState] = useState<InvitePreviewState>({ status: 'loading' });
  const [signedIn] = useState(() => hasAuthHint());

  useEffect(() => {
    const token = readInviteToken(window.location.hash);
    if (token) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    if (!token) {
      setState({ status: 'unavailable' });
      return;
    }
    let cancelled = false;
    KbRepository.previewInvitation(token)
      .then((preview) => {
        if (cancelled) return;
        setState(preview.status === 'pending' ? { status: 'pending', preview } : { status: 'unavailable' });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { state, signedIn };
}
