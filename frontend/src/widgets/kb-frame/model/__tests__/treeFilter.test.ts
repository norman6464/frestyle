import { describe, expect, it } from 'vitest';
import type { KbPageTreeNode } from '@/entities/kb';
import { filterTreeByTitle, subtreeOf } from '../treeFilter';

function node(id: string, title: string, children: KbPageTreeNode[] = [], hidden = false): KbPageTreeNode {
  return {
    page: { id, spaceId: 's-1', title, createdByUserId: 1, createdAt: '', updatedAt: '' },
    children,
    hasHiddenChildren: hidden,
    parentArchived: false,
  };
}

// 設計 ─┬ 画面の枠
//       └ 招待 ─ 招待メール
// 議事録
const TREE = [
  node('design', '設計', [node('shell', '画面の枠'), node('invite', '招待', [node('mail', '招待メール')], true)]),
  node('minutes', '議事録'),
];

const ids = (nodes: KbPageTreeNode[]): unknown[] =>
  nodes.map((n) => (n.children.length > 0 ? [n.page.id, ids(n.children)] : n.page.id));

describe('filterTreeByTitle', () => {
  it('一致したページと、その祖先だけを残す', () => {
    const { nodes } = filterTreeByTitle(TREE, '枠');
    expect(ids(nodes)).toEqual([['design', ['shell']]]);
  });

  it('一致したページの祖先は開いておく（畳みの中に一致を隠さない）', () => {
    const { expandedPageIds } = filterTreeByTitle(TREE, 'メール');
    expect([...expandedPageIds].sort()).toEqual(['design', 'invite']);
  });

  it('祖先そのものが一致したときも、一致した子孫は残す', () => {
    const { nodes } = filterTreeByTitle(TREE, '招待');
    expect(ids(nodes)).toEqual([['design', [['invite', ['mail']]]]]);
  });

  it('大文字小文字・全角半角の違いでは取りこぼさない', () => {
    const tree = [node('a', 'ＡＰＩ 設計'), node('b', 'api メモ')];
    expect(ids(filterTreeByTitle(tree, 'Api').nodes)).toEqual(['a', 'b']);
  });

  it('一致が無ければ空。空白だけの語も何にも一致しない', () => {
    expect(filterTreeByTitle(TREE, '存在しない').nodes).toEqual([]);
    expect(filterTreeByTitle(TREE, '   ').nodes).toEqual([]);
  });

  it('絞っている間は「見えないページが在る」印を出さない', () => {
    const { nodes } = filterTreeByTitle(TREE, 'メール');
    const invite = nodes[0].children[0];
    expect(invite.page.id).toBe('invite');
    expect(invite.hasHiddenChildren).toBe(false);
  });
});

describe('subtreeOf', () => {
  it('深い段のページでも、その子孫ごと取り出す', () => {
    const found = subtreeOf(TREE, 'invite');
    expect(found && ids([found])).toEqual([['invite', ['mail']]]);
  });

  it('見つからなければ null', () => {
    expect(subtreeOf(TREE, 'nope')).toBeNull();
  });
});
