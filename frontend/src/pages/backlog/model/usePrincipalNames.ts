import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { queryShownState } from '@/shared/api/queryState';
import { kbWorkspacePrincipalsQuery, type KbGrantablePrincipal } from '@/entities/kb';

const NO_PRINCIPALS: KbGrantablePrincipal[] = [];

/**
 * usePrincipalNames はワークスペース内の「権限を張れる相手」を principalId → 表示名の
 * 対応表として読む（設計 Ⅳ-G）。担当者アバターの名前・担当を選ぶプルダウンの選択肢の
 * 両方をこれ 1 つでまかなう。
 *
 * 引き方（最初のページで代表させる妥協）は kbWorkspacePrincipalsQuery に書いてある。バックログと
 * チケットの画面が同じ結果を使うので、画面を行き来しても取り直さない。1 枚も見つからなければ
 * 対応表は空のまま（呼び出し側は principalId の先頭だけで頭文字を出す）。
 */
export function usePrincipalNames(workspaceSlug: string | undefined) {
  const active = workspaceSlug !== undefined;
  const result = useQuery({ ...kbWorkspacePrincipalsQuery(workspaceSlug ?? ''), enabled: active });
  // 引けなければ空のまま（呼び出し側は principalId の先頭だけで頭文字を出す）。
  const { data, loading } = queryShownState(result, active);
  const principals = data ?? NO_PRINCIPALS;

  const nameOf = useCallback(
    (principalId: string | null): string => {
      if (!principalId) return '';
      return principals.find((p) => p.id === principalId)?.name ?? '';
    },
    [principals],
  );

  /** アバターの頭文字。名前が引ければ先頭 2 文字、引けなければ principalId の先頭 2 文字。 */
  const initialsOf = useCallback(
    (principalId: string | null): string => {
      if (!principalId) return '';
      const name = nameOf(principalId);
      const basis = name || principalId;
      return basis.slice(0, 2).toUpperCase();
    },
    [nameOf],
  );

  return { principals, loading, nameOf, initialsOf };
}
