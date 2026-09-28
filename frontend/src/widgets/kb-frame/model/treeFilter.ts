import type { KbPageTreeNode } from '@/entities/kb';

/** 題名を比べる形。大文字小文字と全角半角の揺れで取りこぼさない。 */
function normalize(text: string): string {
  return text.normalize('NFKC').toLocaleLowerCase('ja');
}

export interface FilteredTree {
  nodes: KbPageTreeNode[];
  /** 絞った結果で開いておくページ（一致したページの祖先。開かないと一致が畳みの中に隠れる）。 */
  expandedPageIds: Set<string>;
}

/**
 * filterTreeByTitle は木を題名で絞る（左の列の「このスペースで検索」）。
 *
 * 題名に語を含むページと、その祖先だけを残す。祖先を残すのは、一致したページが
 * どこにあるかを木の形のまま見せるため（一覧に平らに並べると、同じ題名の区別が付かない）。
 * 手元に読み込んである木だけを見る。本文までは探さない（それはサーバーの検索の役目）。
 * 見えないページが在る印（hasHiddenChildren）は絞っている間は出さない —— 語に一致したかが
 * 分からない物を、一致の一覧に混ぜないため。
 */
export function filterTreeByTitle(nodes: KbPageTreeNode[], query: string): FilteredTree {
  const needle = normalize(query.trim());
  const expandedPageIds = new Set<string>();

  const walk = (list: KbPageTreeNode[]): KbPageTreeNode[] => {
    const kept: KbPageTreeNode[] = [];
    for (const node of list) {
      const children = walk(node.children);
      const hit = needle !== '' && normalize(node.page.title).includes(needle);
      if (!hit && children.length === 0) continue;
      if (children.length > 0) expandedPageIds.add(node.page.id);
      kept.push({ ...node, children, hasHiddenChildren: false });
    }
    return kept;
  };

  return { nodes: walk(nodes), expandedPageIds };
}

/**
 * subtreeOf は「この場所のページだけを表示」で使う、あるページとその子孫だけの木。
 * 見つからなければ null（別のスペースのページを開いている・消えた等。呼び出し側は全体のまま）。
 */
export function subtreeOf(nodes: KbPageTreeNode[], pageId: string): KbPageTreeNode | null {
  for (const node of nodes) {
    if (node.page.id === pageId) return node;
    const found = subtreeOf(node.children, pageId);
    if (found) return found;
  }
  return null;
}
