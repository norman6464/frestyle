import { useCallback } from 'react';
import { useWorkspaceMembers } from './useWorkspaceMembers';

/**
 * usePrincipalNames は担当（principalId）から表示名を引く対応表。
 *
 * ワークスペースに属する人の一覧（useWorkspaceMembers）から作る。所属していれば誰でも引ける口で、
 * 担当の選択肢・発言の名指しと同じ一覧を共有するので、画面を行き来しても取り直さない。担当に
 * 入るのは人だけ（グループやスペース全体は入らない）なので、この一覧で足りる。
 * 引けなければ一覧は空のまま（名前は空文字。呼び出し側は principalId の先頭で頭文字を出す）。
 */
export function usePrincipalNames(workspaceSlug: string | undefined) {
  const { members } = useWorkspaceMembers(workspaceSlug);

  const nameOf = useCallback(
    (principalId: string | null): string => {
      if (!principalId) return '';
      return members.find((m) => m.principalId === principalId)?.name ?? '';
    },
    [members],
  );

  return { members, nameOf };
}
