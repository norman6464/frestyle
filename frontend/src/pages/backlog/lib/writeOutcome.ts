import { getApiError } from '@/shared/lib/classifyApiError';

/**
 * 変更の結果を、操作した場所に出すための状態（設計ボード PX04）。
 *
 * - saving: 送っている間。対象の操作だけを押せなくする
 * - saved: 成功が確かめられた（応答を受け取ってから出す。先に出さない）
 * - rejected: サーバーが断った。理由を出し、見た目は変更前のまま
 * - unknown: 通信が切れた・時間切れ・サーバーの障害で、変わったかどうか分からない。
 *   「変更されていません」とは言い切らず、自動で送り直さず、最新を確かめる手立てを出す
 */
export type WriteOutcome =
  | { kind: 'saving'; message: string }
  | { kind: 'saved'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'unknown'; message: string };

export const UNKNOWN_OUTCOME_MESSAGE = '通信が途切れました。変更の結果はまだ確認できていません。';

/**
 * 書き込みの失敗を「断られた」か「分からない」かに分ける。
 *
 * 応答が無い（通信の切断・時間切れ）と 5xx は、サーバー側で変わったかどうか分からない。
 * 4xx は断られたと確かめられる。理由の文言は `reasons`（backend の機械可読コード → 文言）で
 * 引き、無ければ `fallback`。
 */
export function classifyWriteFailure(
  cause: unknown,
  fallback: string,
  reasons: Record<string, string> = {},
): Extract<WriteOutcome, { kind: 'rejected' | 'unknown' }> {
  const { status, serverCode } = getApiError(cause);
  if (status === undefined || status >= 500) return { kind: 'unknown', message: UNKNOWN_OUTCOME_MESSAGE };
  if (serverCode && reasons[serverCode]) return { kind: 'rejected', message: reasons[serverCode] };
  if (status === 403) return { kind: 'rejected', message: 'この操作を行う権限がありません。' };
  if (status === 404) return { kind: 'rejected', message: '対象が見つかりません。最新を確認してください。' };
  return { kind: 'rejected', message: fallback };
}
