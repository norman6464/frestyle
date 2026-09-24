import type { EmailVerification } from '@/features/auth';
import { Button } from '@/shared/ui';
import InvitationStateCard from './InvitationStateCard';

export interface EmailVerificationPanelProps {
  verification: EmailVerification;
  /** 確認が取り込めたら一覧を読み直す。 */
  onVerified: () => void;
}

/**
 * メールアドレスの確認が済んでいない人への案内。招待はメールアドレス宛に届くので、
 * 確認済みのアドレスが無いと突き合わせられない。
 *
 * 設定にはメールの項目が無いので、ほかの画面へ送らずここで済ませる: 確認メールを送り直し、
 * リンクを開いたら「確認を済ませた」で取り込んで、そのまま一覧を読み直す。
 */
export default function EmailVerificationPanel({ verification, onVerified }: EmailVerificationPanelProps) {
  if (!verification.available) {
    return (
      <InvitationStateCard
        title="メールアドレスの確認が必要です"
        description="招待はメールアドレス宛に届きます。確認済みのメールアドレスでログインし直してから、もう一度開いてください。"
      />
    );
  }

  const { email, sending, checking, send, confirm, message } = verification;
  return (
    <InvitationStateCard
      title="メールアドレスの確認が必要です"
      description={
        <>
          招待はメールアドレス宛に届きます。
          {email ? (
            <>
              <strong className="font-semibold text-[var(--color-text-secondary)] [overflow-wrap:anywhere]">{email}</strong>
              の確認が済むと、ここに招待が並びます。
            </>
          ) : (
            '確認が済むと、ここに招待が並びます。'
          )}
        </>
      }
      action={
        <>
          <Button variant="primary" onClick={() => void send()} loading={sending} disabled={checking}>
            確認メールを送る
          </Button>
          <Button
            variant="secondary"
            onClick={() => {
              void confirm().then((verified) => {
                if (verified) onVerified();
              });
            }}
            loading={checking}
            disabled={sending}
          >
            確認を済ませた
          </Button>
        </>
      }
    >
      {/* 結果は押した操作のすぐ下に出す（送った・まだ確認されていない・失敗）。 */}
      <p
        role="status"
        aria-live="polite"
        className={
          message
            ? `mt-4 text-sm leading-relaxed ${message.tone === 'error' ? 'text-danger-ink' : 'text-[var(--color-text-secondary)]'}`
            : 'sr-only'
        }
      >
        {message?.text ?? ''}
      </p>
    </InvitationStateCard>
  );
}
