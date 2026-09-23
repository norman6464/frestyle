import type { KbInvitationStatus } from '@/entities/kb';
import { getApiError } from '@/shared/lib/classifyApiError';

/** 状態の表示名。 */
export const INVITATION_STATUS_LABEL: Record<KbInvitationStatus, string> = {
  pending: '承諾待ち',
  expired: '期限切れ',
  accepted: '承諾済み',
  declined: '辞退',
  revoked: '取り消し',
};

/** 状態のバッジの見た目。色は「結果」を表すので brand（押せる）とは分ける。 */
export const INVITATION_STATUS_CLASS: Record<KbInvitationStatus, string> = {
  pending: 'bg-brand-50 text-brand-700',
  expired: 'bg-warning-soft text-warning',
  accepted: 'bg-success-soft text-success',
  declined: 'bg-surface-2 text-[var(--color-text-muted)]',
  revoked: 'bg-surface-2 text-[var(--color-text-muted)]',
};

/** 招待の失敗の文言と、出す場所（メールアドレス欄の下・フォームの帯・トースト）。 */
export type InviteFailure =
  | { where: 'email'; text: string }
  | { where: 'form'; text: string }
  | { where: 'toast'; text: string };

/**
 * inviteFailure は発行・再送・取消の失敗を場所つきの文言にする。
 * backend の機械可読コード（kb_invitation_handler.go の respondKbInvitationErr）に直接対応させる。
 * 汎用の classifyApiError（ステータスコードだけを見る）だと、429 が「多すぎる」としか言えず、
 * 「待てば送れる」のか「今日はもう送れない」のかを出せない。
 */
export function inviteFailure(cause: unknown): InviteFailure {
  const { status, serverCode } = getApiError(cause);
  if (status === 400) {
    return { where: 'email', text: 'メールアドレスの形式を確認してください。表示名付き（山田 <a@b>）は使えません。' };
  }
  if (status === 429 && serverCode === 'resend_too_soon') {
    return { where: 'form', text: 'この宛先には 10 分以内に送っています。しばらく待ってから再送してください。' };
  }
  if (status === 429 && serverCode === 'invitation_email_limit') {
    return { where: 'form', text: 'この宛先への招待は今日はもう作れません（1 日 5 件まで）。' };
  }
  if (status === 429) {
    return { where: 'form', text: '今日の招待の上限（50 件）に達しました。明日また試してください。' };
  }
  if (status === 409 && serverCode === 'too_many_open_invitations') {
    return { where: 'form', text: '承諾待ちの招待が 100 件あります。古いものを取り消してから作ってください。' };
  }
  if (status === 409) {
    return { where: 'toast', text: 'この招待はもう承諾・辞退されているか、取り消し済みです。一覧を更新します。' };
  }
  if (status === 404) {
    return { where: 'toast', text: '対象が見当たりません。権限が無いか、すでに取り消されています。一覧を更新します。' };
  }
  return { where: 'toast', text: '操作に失敗しました。もう一度お試しください。' };
}

/** 期限などの日付を「9月30日」の形に。時刻は出さない（承諾できるかは日で足りる）。 */
export function formatInvitationDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}
