import { getApiError } from '@/shared/lib/classifyApiError';

/**
 * 作成の失敗を、作成ボタンのそばに出す文言にする。
 *
 * 応答が無い・時間切れ・5xx は「作れなかった」と言い切らない（サーバーでは作れている
 * かもしれない）。自動では送り直さず、作成先で確かめてもらう（同じものを 2 つ作らないため）。
 */
export function createFailureMessage(cause: unknown, kind: 'page' | 'ticket'): string {
  const { status } = getApiError(cause);
  const place = kind === 'page' ? 'ナレッジ' : 'バックログ';
  if (status === undefined || status >= 500) {
    return `作成できたか確認できません。同じものを作り直す前に、${place}で確かめてください。`;
  }
  if (status === 403) return 'この場所に作る権限がありません。作成先を選び直してください。';
  if (status === 404) return '作成先が見つかりません。作成先を選び直してください。';
  if (status === 400) return '入力を確かめてください。タイトルは 200 文字までです。';
  return '作成できませんでした。もう一度お試しください。';
}
