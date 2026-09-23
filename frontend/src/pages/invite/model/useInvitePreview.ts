import { useCallback, useEffect, useRef, useState } from 'react';
import { KbRepository, readInviteToken, type KbInvitationPreview } from '@/entities/kb';
import { hasAuthHint } from '@/shared/lib/authHint';

export type InvitePreviewState =
  | { status: 'loading' }
  | { status: 'pending'; preview: KbInvitationPreview }
  /** 無い・期限切れ・結果済み。理由は返らない（トークンを持っているだけの相手に教えない）。 */
  | { status: 'unavailable' }
  /** 通信が切れた等。招待が無いのではなく、確かめられていない状態。retry で同じトークンを引き直せる。 */
  | { status: 'error' };

/**
 * useInvitePreview は招待リンク（/invite#t=<token>）を開いたときの案内を取る。
 *
 * トークンは URL のフラグメントから読んだら**すぐ URL から消す**（履歴・共有・スクリーンショットに
 * 残さない）。読んだ値はこのフックの中にだけ持ち、本文で POST /kb/invitations/preview に送る。
 * 通信に失敗したときの再試行も同じ値で行う（ページを読み直すと URL にはもうトークンが無い）。
 * ログインしているかは発行者の状態ではなく目印 Cookie（hasAuthHint）で見る — この画面は認証の外側にあり、
 * Redux の認証状態は初期化されていないため。
 */
export function useInvitePreview() {
  const [state, setState] = useState<InvitePreviewState>({ status: 'loading' });
  const [signedIn] = useState(() => hasAuthHint());
  // URL から消したあとのトークンの唯一の置き場。描画に使わないので ref。
  const token = useRef<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(() => {
    const current = token.current;
    if (!current) {
      setState({ status: 'unavailable' });
      return;
    }
    const request = ++seq.current;
    setState({ status: 'loading' });
    KbRepository.previewInvitation(current)
      .then((preview) => {
        if (seq.current !== request) return;
        setState(preview.status === 'pending' ? { status: 'pending', preview } : { status: 'unavailable' });
      })
      .catch(() => {
        if (seq.current === request) setState({ status: 'error' });
      });
  }, []);

  useEffect(() => {
    token.current = readInviteToken(window.location.hash);
    if (token.current) {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    }
    load();
    return () => {
      seq.current += 1;
    };
  }, [load]);

  return { state, signedIn, retry: load };
}
