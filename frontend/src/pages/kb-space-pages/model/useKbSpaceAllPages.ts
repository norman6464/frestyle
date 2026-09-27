import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { kbPageTreeQuery, type KbPage, type KbPageTree, type KbPageTreeNode } from '@/entities/kb';

export interface KbFlatPage {
  page: KbPage;
  depth: number;
}

interface KbFlatPages {
  pages: KbFlatPage[];
  hasHiddenChildren: boolean;
}

const NO_PAGES: KbFlatPage[] = [];

/** flatten は木を深さ優先で平坦な一覧に開く（親の直後に子が並ぶ）。 */
function flatten(nodes: KbPageTreeNode[], depth: number): KbFlatPage[] {
  const out: KbFlatPage[] = [];
  for (const node of nodes) {
    out.push({ page: node.page, depth });
    out.push(...flatten(node.children, depth + 1));
  }
  return out;
}

function toFlatPages(tree: KbPageTree): KbFlatPages {
  return { pages: flatten(tree.pages, 0), hasHiddenChildren: tree.hasHiddenChildren };
}

/**
 * スペースのすべてのページ（現役）を、親の直後に子が並ぶ一覧で返す。
 *
 * 左の列と同じ木（kbPageTreeQuery）から導くので、取ってあれば取り直さず、左の列やページの
 * 画面でページを作った・改名したらこの一覧にもそのまま届く。読み込み中と失敗を出すのは、
 * 木が 1 度も取れていないときだけ。
 */
export function useKbSpaceAllPages(workspaceSlug: string, spaceId: string) {
  const result = useQuery({ ...kbPageTreeQuery(workspaceSlug, spaceId), select: toFlatPages });
  const missing = result.data === undefined;

  const { refetch } = result;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  return {
    pages: result.data?.pages ?? NO_PAGES,
    hasHiddenChildren: result.data?.hasHiddenChildren ?? false,
    loading: missing && (result.isPending || result.isFetching),
    error: missing && result.isError && !result.isFetching ? 'ページを読み込めませんでした。' : null,
    retry,
  };
}
