import { useCallback, useState } from 'react';
import { sendEmailVerification } from 'firebase/auth';
import { AuthRepository } from '@/entities/user';
import { getFirebaseAuth } from '@/shared/lib/auth/firebaseApp';
import { resolveAuthMode } from '@/shared/lib/auth/currentIdToken';

/**
 * メールアドレスの確認（確認メールの再送と、確認が済んだことの取り込み）。
 *
 * backend は ID トークンの `email_verified` が true になるまで、そのアドレスを「無い」ものとして
 * 扱う（他人のアドレスの先取りを防ぐため）。確認リンクを踏んだあとも、backend が知るのは
 * 新しいトークンでセッションを張り直したとき（`/auth/login`）なので、「確認を済ませた」は
 * 次の 3 つをこの順に行う: 発行者から最新の状態を読み直す → トークンを取り直す → backend へ
 * 張り直す。
 *
 * 再送できるのは本番の発行者（GCIP）のときだけ。ローカルの Dex は確認済みのアドレスしか
 * 発行しないので、この画面に来ることは無い（来たら案内だけを出す）。
 */
export type EmailVerification =
  | {
      readonly available: true;
      /** 発行者が知っているアドレス。サインインしていなければ null。 */
      readonly email: string | null;
      readonly sending: boolean;
      readonly checking: boolean;
      /** 確認メールを送る。成功で true。失敗は message に理由が入る。 */
      readonly send: () => Promise<boolean>;
      /** 確認が済んでいれば backend へ取り込み true。まだなら false。 */
      readonly confirm: () => Promise<boolean>;
      /** 直前の操作の結果（送った・まだ確認されていない・失敗）。 */
      readonly message: { tone: 'info' | 'error'; text: string } | null;
    }
  | { readonly available: false };

function errorCode(cause: unknown): string {
  return typeof cause === 'object' && cause !== null && 'code' in cause ? String((cause as { code: unknown }).code) : '';
}

export function useEmailVerification(): EmailVerification {
  const [sending, setSending] = useState(false);
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const available = resolveAuthMode() === 'firebase';
  const user = available ? getFirebaseAuth()?.currentUser ?? null : null;

  const send = useCallback(async () => {
    const current = getFirebaseAuth()?.currentUser;
    if (!current) {
      setMessage({ tone: 'error', text: 'ログインし直してから、もう一度お試しください。' });
      return false;
    }
    setSending(true);
    setMessage(null);
    try {
      await sendEmailVerification(current);
      setMessage({
        tone: 'info',
        text: `${current.email ?? 'あなたのメールアドレス'} に確認メールを送りました。届いたリンクを開いてから「確認を済ませた」を押してください。`,
      });
      return true;
    } catch (cause) {
      setMessage({
        tone: 'error',
        text:
          errorCode(cause) === 'auth/too-many-requests'
            ? '続けて送りすぎています。少し待ってからもう一度お試しください。'
            : '確認メールを送れませんでした。時間をおいてもう一度お試しください。',
      });
      return false;
    } finally {
      setSending(false);
    }
  }, []);

  const confirm = useCallback(async () => {
    const current = getFirebaseAuth()?.currentUser;
    if (!current) {
      setMessage({ tone: 'error', text: 'ログインし直してから、もう一度お試しください。' });
      return false;
    }
    setChecking(true);
    setMessage(null);
    try {
      await current.reload();
      if (!current.emailVerified) {
        setMessage({ tone: 'info', text: 'まだ確認が済んでいません。メールのリンクを開いてから、もう一度押してください。' });
        return false;
      }
      await current.getIdToken(true);
      await AuthRepository.login();
      return true;
    } catch {
      setMessage({ tone: 'error', text: '確認の状態を読み込めませんでした。時間をおいてもう一度お試しください。' });
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  if (!available) return { available: false };
  return { available: true, email: user?.email ?? null, sending, checking, send, confirm, message };
}
