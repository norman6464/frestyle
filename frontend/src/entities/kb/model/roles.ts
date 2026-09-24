import type { KbGrantRole } from './types';

/**
 * 役割の呼び名。画面に出す日本語はここにだけ置く（画面ごとに表を持つと、同じ役割が画面に
 * よって別の名前で出る）。
 *
 * 値（admin / editor / commenter / viewer）は backend の domain.GrantRole と同じで、画面には
 * 出さない。
 */
export const KB_ROLE_LABEL: Readonly<Record<KbGrantRole, string>> = {
  admin: '管理者',
  editor: '編集者',
  commenter: 'コメント可',
  viewer: '閲覧者',
};

/** 役割でできること（招待の選択肢や、招待の案内に添える）。 */
export const KB_ROLE_DESCRIPTION: Readonly<Record<KbGrantRole, string>> = {
  admin: 'メンバーと権限の管理もできる',
  editor: 'ページを作り、編集できる',
  commenter: '閲覧とコメントができる',
  viewer: '閲覧だけ',
};

/** 強い順。選択肢はこの順に並べる（一覧と追加で並びが食い違わないよう、1 つだけ持つ）。 */
export const KB_ROLES_STRONGEST_FIRST: ReadonlyArray<KbGrantRole> = ['admin', 'editor', 'commenter', 'viewer'];

function isKbGrantRole(value: string): value is KbGrantRole {
  return (KB_ROLES_STRONGEST_FIRST as ReadonlyArray<string>).includes(value);
}

/**
 * kbRoleLabel は役割の値を呼び名にする。知らない値（backend が先に増やした場合など）は、
 * 空欄にせずそのまま出す（何かが出ていれば、読めない値だと気づける）。
 */
export function kbRoleLabel(role: string | null | undefined): string {
  if (!role) return '';
  return isKbGrantRole(role) ? KB_ROLE_LABEL[role] : role;
}

/** kbRoleDescription は役割でできること。知らない値は空文字。 */
export function kbRoleDescription(role: string | null | undefined): string {
  if (!role) return '';
  return isKbGrantRole(role) ? KB_ROLE_DESCRIPTION[role] : '';
}
