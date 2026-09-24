import { getApiError } from '@/shared/lib/classifyApiError';

/** backend が本人 × プロジェクトで持てる保存した絞り込みの上限（usecase の定数と同じ値）。 */
export const MAX_SAVED_FILTERS = 20;

/**
 * 保存した絞り込みの保存・改名・削除が失敗したときの文言。理由が分かる失敗は理由を返し、
 * その場で直せるようにする（同名・上限・条件なし・名前の長さ）。分からない失敗は fallback。
 */
export function savedFilterErrorMessage(cause: unknown, fallback: string): string {
  const { status, serverCode } = getApiError(cause);
  if (status === 403) return 'この操作を行う権限がありません。';
  switch (serverCode) {
    case 'saved_filter_name_taken':
      return '同じ名前の絞り込みがあります。別の名前にしてください。';
    case 'saved_filter_limit_reached':
      return `保存できる絞り込みは ${MAX_SAVED_FILTERS} 件までです。使わないものを削除してください。`;
    case 'filter_has_no_condition':
      return '条件を 1 つ以上付けてから保存してください。';
    case 'invalid_filter_name':
      return '名前は 1〜60 文字で入力してください。';
    case 'assignee_mode_conflict':
      return '担当の条件は 1 つだけにしてください。';
    default:
      return fallback;
  }
}
