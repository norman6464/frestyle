import { useEffect, useId, useRef, useState, type FormEvent, type SyntheticEvent } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { buildInviteUrl, type KbGrantRole, type KbInviteByEmailInput, type KbIssuedInvitation } from '@/entities/kb';
import { Button, FsIcon } from '@/shared/ui';
import FormFieldError from '@/shared/ui/FormFieldError';
import { useCopyToClipboard } from '@/shared/lib/hooks/useCopyToClipboard';
import { inviteFailure } from '../lib/invitationMessages';

const ROLE_OPTIONS: { value: KbGrantRole; label: string }[] = [
  { value: 'admin', label: 'admin — メンバーと権限の管理もできる' },
  { value: 'editor', label: 'editor — ページを作り、編集できる' },
  { value: 'commenter', label: 'commenter — 閲覧とコメントができる' },
  { value: 'viewer', label: 'viewer — 閲覧だけ' },
];

export interface KbInviteDialogProps {
  isOpen: boolean;
  /**
   * 再送の結果を見せるために開くとき、その応答を渡す。入力欄を飛ばしてリンクの表示から始まる。
   * null / undefined なら入力欄から。
   */
  issued?: KbIssuedInvitation | null;
  /** 発行する。**失敗は投げてくる**（このダイアログの中で文言にする）。 */
  onInvite: (input: KbInviteByEmailInput) => Promise<KbIssuedInvitation>;
  /** 一覧の更新を伴わない失敗（404 等）を外へ知らせたいときに使う。 */
  onFailureToast: (text: string) => void;
  onClose: () => void;
}

const FIELD_CLASS =
  'min-h-11 w-full rounded-lg border border-[var(--fs-control-border)] bg-[var(--fs-control-surface)] px-3 text-base text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600 disabled:opacity-50 md:text-sm';

/**
 * KbInviteDialog は「メンバーを招く」。email・名前（任意）・役割を受けて招待を作り、
 * できた招待リンクを**この場でだけ**見せる（token はこの応答の外には残らない）。
 *
 * 2 段: 入力 → リンク。閉じたら打ちかけも発行済みのリンクも持ち越さない（次に開いたとき
 * 別の人のリンクが見えないように）。フォーカス・Escape・復帰先は Base UI に任せる
 * （ConfirmModal と同じ）。
 */
export default function KbInviteDialog({ isOpen, issued: issuedProp, onInvite, onFailureToast, onClose }: KbInviteDialogProps) {
  const titleId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<KbGrantRole>('editor');
  const [submitting, setSubmitting] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [issued, setIssued] = useState<KbIssuedInvitation | null>(null);
  const { copiedId, copyToClipboard } = useCopyToClipboard();

  // 開くたびに白紙から（再送で開いたときは、その結果のリンクから）。
  useEffect(() => {
    if (!isOpen) return;
    setEmail('');
    setName('');
    setRole('editor');
    setSubmitting(false);
    setEmailError(null);
    setFormError(null);
    setIssued(issuedProp ?? null);
  }, [isOpen, issuedProp]);

  const stopPropagation = (event: SyntheticEvent) => event.stopPropagation();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setEmailError(null);
    setFormError(null);
    try {
      const result = await onInvite({ email, name: name.trim() || undefined, role });
      setIssued(result);
    } catch (cause) {
      const failure = inviteFailure(cause);
      if (failure.where === 'email') setEmailError(failure.text);
      else if (failure.where === 'form') setFormError(failure.text);
      else onFailureToast(failure.text);
    } finally {
      setSubmitting(false);
    }
  };

  const inviteUrl = issued ? buildInviteUrl(window.location.origin, issued.token) : '';
  const copied = copiedId === 'invite-link';
  // メールの結果で見出しと案内を変える。招待そのものはどの結果でもできている。
  const mailStatus = issued?.mailStatus ?? 'disabled';

  return (
    <Dialog.Root open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Backdrop
          className="fixed inset-0 z-50 bg-black/50"
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
          onContextMenu={stopPropagation}
          onDragStart={stopPropagation}
        />
        <Dialog.Popup
          aria-modal="true"
          aria-labelledby={titleId}
          initialFocus={issued ? undefined : emailRef}
          onClick={stopPropagation}
          onMouseDown={stopPropagation}
          onContextMenu={stopPropagation}
          onDragStart={stopPropagation}
          className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-[var(--fs-dialog-border)] bg-[var(--fs-dialog-surface)] p-6 shadow-xl focus:outline-none"
        >
          {issued ? (
            <div className="flex flex-col gap-5">
              <div className="flex flex-col items-center gap-3 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success-soft text-success" aria-hidden="true">
                  <FsIcon name="check" className="h-6 w-6" />
                </div>
                <Dialog.Title id={titleId} className="text-xl font-semibold text-[var(--fs-text-strong)] [overflow-wrap:anywhere]">
                  {mailStatus === 'sent'
                    ? `${issued.invitation.email} に招待を送りました`
                    : `${issued.invitation.email} 宛の招待リンクを作りました`}
                </Dialog.Title>
                <Dialog.Description className="text-sm leading-relaxed text-[var(--fs-text-muted)]">
                  {mailStatus === 'sent'
                    ? 'メールに招待リンクを載せて送りました。届かないときは、下のリンクを相手に渡してください。'
                    : 'このリンクを相手に渡してください。開くと招待の内容が見られ、同じメールアドレスのアカウントでログインすると参加できます。'}
                </Dialog.Description>
              </div>
              {mailStatus === 'failed' && (
                <p role="alert" className="flex gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger-ink">
                  <FsIcon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>メールを送れませんでした。招待はできているので、下のリンクを相手に渡すか、あとで一覧の「再送」でもう一度送ってください。</span>
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="kb-invite-link" className="text-sm font-medium text-[var(--color-text-secondary)]">招待リンク</label>
                <div className="flex gap-2">
                  <input
                    id="kb-invite-link"
                    type="text"
                    readOnly
                    value={inviteUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-h-11 min-w-0 flex-1 rounded-lg border border-[var(--fs-control-border)] bg-surface-2 px-3 text-sm text-[var(--color-text-secondary)]"
                  />
                  <Button type="button" variant="primary" onClick={() => void copyToClipboard('invite-link', inviteUrl)} className="min-h-11 shrink-0">
                    <FsIcon name="copy" className="h-4 w-4" />
                    {copied ? 'コピーしました' : 'コピー'}
                  </Button>
                </div>
              </div>
              <p role="note" className="flex gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
                <FsIcon name="alert-circle" className="mt-0.5 h-4 w-4 shrink-0" />
                <span>このリンクはこの画面を閉じると表示できません。閉じたあとは一覧の「再送」で新しいリンクを作れます（前のリンクは使えなくなります）。期限は 7 日です。</span>
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                {!issuedProp && (
                  <Button type="button" variant="ghost" onClick={() => setIssued(null)} className="min-h-11">
                    もう 1 人招く
                  </Button>
                )}
                <Button type="button" variant="secondary" onClick={onClose} className="min-h-11">
                  閉じる
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <Dialog.Title id={titleId} className="text-xl font-semibold text-[var(--fs-text-strong)]">メンバーを招く</Dialog.Title>
                <Dialog.Description className="text-sm leading-relaxed text-[var(--fs-text-muted)]">
                  メールアドレス宛に招待を作ります。相手が承諾するまで、所属や権限は発生しません。
                </Dialog.Description>
              </div>
              {formError && (
                <p role="alert" className="flex gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning">
                  <FsIcon name="alert-triangle" className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </p>
              )}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="kb-invite-email" className="text-sm font-medium text-[var(--color-text-secondary)]">
                  メールアドレス <span className="text-danger-ink" aria-hidden="true">*</span>
                </label>
                <input
                  ref={emailRef}
                  id="kb-invite-email"
                  type="email"
                  required
                  autoComplete="off"
                  placeholder="taro@example.com"
                  value={email}
                  disabled={submitting}
                  aria-invalid={emailError ? true : undefined}
                  onChange={(e) => { setEmail(e.target.value); setEmailError(null); }}
                  className={FIELD_CLASS}
                />
                <FormFieldError name="kb-invite-email" error={emailError ?? undefined} />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="kb-invite-name" className="text-sm font-medium text-[var(--color-text-secondary)]">
                  名前 <span className="font-normal text-[var(--color-text-muted)]">（任意）</span>
                </label>
                <input
                  id="kb-invite-name"
                  type="text"
                  autoComplete="off"
                  maxLength={200}
                  placeholder="山田 太郎"
                  value={name}
                  disabled={submitting}
                  onChange={(e) => setName(e.target.value)}
                  className={FIELD_CLASS}
                />
                <p className="text-xs text-[var(--color-text-muted)]">案内と一覧に「○○さんへの招待」と出すためだけに使います。相手のプロフィール名は変わりません。</p>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="kb-invite-role" className="text-sm font-medium text-[var(--color-text-secondary)]">役割</label>
                <select
                  id="kb-invite-role"
                  value={role}
                  disabled={submitting}
                  onChange={(e) => setRole(e.target.value as KbGrantRole)}
                  className={FIELD_CLASS}
                >
                  {ROLE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
                <p className="text-xs text-[var(--color-text-muted)]">承諾したときにワークスペース全体へ張られる役割です。あとからメンバー管理で変えられます。</p>
              </div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="secondary" onClick={onClose} disabled={submitting} className="min-h-11">
                  キャンセル
                </Button>
                <Button type="submit" variant="primary" loading={submitting} disabled={email.trim() === ''} className="min-h-11">
                  招待を作る
                </Button>
              </div>
            </form>
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
